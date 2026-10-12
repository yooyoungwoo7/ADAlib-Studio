import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistPanel, canon, type ChatEntry } from "./components/assist/AssistPanel";
import { Button } from "./components/common/controls";
import { Console } from "./components/layout/Console";
import { MODULE_OF, Sidebar } from "./components/layout/Sidebar";
import { Toolbar } from "./components/layout/Toolbar";
import { FIGURE_IDS, FigureStyleContext, type FigureInfo, type FigureStyle } from "./plots/figureStyle";
import { useBackend, useJob, useMediaQuery, usePlotStyle, useTheme } from "./hooks/hooks";
import { useForwardModule } from "./modules/forward/useForwardModule";
import { useInverseModule } from "./modules/inverse/useInverseModule";
import { useMPCModule } from "./modules/mpc/useMPCModule";
import { useOperatorModule } from "./modules/operator/useOperatorModule";
import type { ModuleContext, ModuleView } from "./modules/types";
import {
  blankProject,
  download,
  FALLBACK_FORWARD_DEFAULTS,
  forwardFromExample,
  inverseFromExample,
  mpcFromExample,
  parseProjectFile,
  serializeProject,
  slug,
  type Project,
} from "./project";
import { api } from "./services/api";
import type { Example, ForwardOptions, ForwardRunRequest, JobStatus, ModuleId, SystemSpec, TimeSpan } from "./types/api";

/** A Forward setup as a run stores it (names trimmed, editor-only fields left out), for comparisons. */
const forwardKey = (system: SystemSpec, time: TimeSpan) =>
  canon({
    name: system.name,
    states: system.states.map((s) => [s.name.trim(), s.initial]),
    parameters: system.parameters.map((q) => [q.name.trim(), q.value]),
    equations: system.equations.map((e) => e.replace(/\s+/g, "")),
    time: [time.t0, time.t1],
  });

// AI assistant panel: height and collapsed state are remembered per browser
const ASSIST_KEY = "adalib-studio-assistant-panel";
function savedAssist(): { height: number; collapsed: boolean } {
  try {
    const s = JSON.parse(localStorage.getItem(ASSIST_KEY) ?? "null");
    if (s && typeof s.height === "number") return { height: s.height, collapsed: !!s.collapsed };
  } catch {
    /* defaults */
  }
  return { height: Math.round(window.innerHeight * 0.45), collapsed: false };
}

// AI figure styles, remembered per browser like the theme (the project file carries them too)
const FIGURES_KEY = "adalib-studio-figures";
function savedFigures(): Project["figures"] {
  try {
    const s = JSON.parse(localStorage.getItem(FIGURES_KEY) ?? "null");
    return s && typeof s === "object" && !Array.isArray(s) ? s : undefined;
  } catch {
    return undefined;
  }
}


export default function App() {
  const theme = useTheme();
  const plotStyle = usePlotStyle();
  const { health, caps, conn } = useBackend();
  const forwardDefaults = useMemo<ForwardOptions>(() => {
    const d = caps?.modules.forward.option_defaults;
    if (!d || d.error) return FALLBACK_FORWARD_DEFAULTS;
    const { verbose: _verbose, error: _error, ...rest } = d as Partial<ForwardOptions> & { verbose?: boolean; error?: string };
    return { ...FALLBACK_FORWARD_DEFAULTS, ...rest };
  }, [caps]);

  const [project, setProjectState] = useState<Project>(() => ({ ...blankProject(FALLBACK_FORWARD_DEFAULTS), figures: savedFigures() }));
  const setProject = useCallback((fn: (p: Project) => Project) => setProjectState(fn), []);
  const [examples, setExamples] = useState<Example[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [panels, setPanels] = useState(() => ({ left: window.innerWidth >= 1024, right: true, bottom: true }));
  const [consoleHeight, setConsoleHeight] = useState(210);
  const [assist, setAssist] = useState(savedAssist);
  useEffect(() => {
    try {
      localStorage.setItem(ASSIST_KEY, JSON.stringify(assist));
    } catch {
      /* not remembered */
    }
  }, [assist]);
  useEffect(() => {
    try {
      if (project.figures && Object.values(project.figures).some((f) => f && Object.keys(f).length))
        localStorage.setItem(FIGURES_KEY, JSON.stringify(project.figures));
      else localStorage.removeItem(FIGURES_KEY);
    } catch {
      /* not remembered */
    }
  }, [project.figures]);
  // figures on screen, so the assistant knows their layout and traces
  const figuresOnScreen = useRef(new Map<string, FigureInfo>());
  const registerFigure = useCallback((f: FigureInfo) => {
    figuresOnScreen.current.set(f.id, f);
  }, []);
  const unregisterFigure = useCallback((id: string) => {
    figuresOnScreen.current.delete(id);
  }, []);
  const figureStyle = project.figures?.[project.module];
  const figureCtx = useMemo(
    () => ({ style: figureStyle, register: registerFigure, unregister: unregisterFigure }),
    [figureStyle, registerFigure, unregisterFigure],
  );
  // one chat per module, kept while switching modules
  const [chats, setChats] = useState<Record<ModuleId, ChatEntry[]>>({ forward: [], operator: [], inverse: [], mpc: [] });

  // ── examples: load once; start on the paper LV example ──────────────
  const initialised = useRef(false);
  useEffect(() => {
    if (conn !== "online" || initialised.current) return;
    initialised.current = true;
    api
      .examples()
      .then((ex) => {
        setExamples(ex);
        const first = ex.find((e) => e.modules.includes("forward"));
        const firstOp = ex.find((e) => e.modules.includes("operator"));
        const firstInv = ex.find((e) => e.modules.includes("inverse"));
        const firstMpc = ex.find((e) => e.modules.includes("mpc"));
        setProject((p) => ({
          ...p,
          name: first?.title ?? p.name,
          forward: first ? { ...forwardFromExample(first, forwardDefaults), plotStyle: p.forward.plotStyle } : p.forward,
          inverse: firstInv ? inverseFromExample(firstInv) : p.inverse,
          mpc: firstMpc ? mpcFromExample(firstMpc, p.mpc) : p.mpc,
          operator: firstOp ? { ...p.operator, exampleId: firstOp.id, system: structuredClone(firstOp.system), n_seg: firstOp.operator?.n_seg ?? p.operator.n_seg, t_final: firstOp.operator?.t_final ?? p.operator.t_final } : p.operator,
        }));
      })
      .catch(() => (initialised.current = false));
  }, [conn, forwardDefaults, setProject]);

  // ── jobs ─────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const refreshJobs = useCallback(() => {
    api.jobs().then(setJobs).catch(() => {});
  }, []);
  useEffect(() => {
    if (conn === "online") refreshJobs();
  }, [conn, refreshJobs]);
  const job = useJob(jobId, refreshJobs);
  const running = job.status?.status === "running" || job.status?.status === "pending";
  const showJob = useCallback(
    (id: string | null) => {
      setJobId(id);
      if (id) {
        setPanels((p) => (p.bottom ? p : { ...p, bottom: true }));
        refreshJobs();
      }
    },
    [refreshJobs],
  );

  const ctx: ModuleContext = {
    conn,
    health,
    caps,
    forwardDefaults,
    themeKey: plotStyle.style === "paper" ? "paper" : theme.resolved,
    examples,
    project,
    setProject,
    job,
    jobId,
    showJob,
    notify: setNotice,
    historyKey: jobs.map((j) => j.id).join(","),
  };
  // every module hook runs on every render (rules of hooks); only the active one is shown
  const views: Partial<Record<ModuleId, ModuleView>> = {
    forward: useForwardModule(ctx),
    operator: useOperatorModule(ctx),
    inverse: useInverseModule(ctx),
    mpc: useMPCModule(ctx),
  };
  const view = views[project.module]!;
  const runBlockReason = view.blockReason;

  // the Forward setup last loaded from a run or sent as a run: replacing it loses nothing
  const forwardSaved = useRef<string | null>(null);
  const run = useCallback(async () => {
    if (runBlockReason || running) return;
    setNotice(null);
    try {
      const id = await view.run();
      if (project.module === "forward") forwardSaved.current = forwardKey(project.forward.system, project.forward.time);
      showJob(id);
    } catch (e) {
      setNotice(`Run rejected: ${(e as Error).message}`);
    }
  }, [view, runBlockReason, running, showJob, project.module, project.forward.system, project.forward.time]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  const openFile = async (f: File) => {
    try {
      const pf = parseProjectFile(await f.text(), forwardDefaults);
      setProject((p) => ({ ...pf.project, figures: pf.project.figures ?? p.figures }));
      setJobId(pf.last_job_id && jobs.some((j) => j.id === pf.last_job_id) ? pf.last_job_id : null);
      setNotice(`Opened "${pf.project.name}".`);
    } catch (e) {
      setNotice(`Could not open ${f.name}: ${(e as Error).message}`);
    }
  };

  // ── console / assistant resize ───────────────────────────────────────
  const drag = (e: React.PointerEvent, h0: number, set: (h: number) => void, min: number, max: number) => {
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => set(Math.min(Math.max(h0 - (ev.clientY - y0), min), window.innerHeight * max));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const startResize = (e: React.PointerEvent) => drag(e, consoleHeight, setConsoleHeight, 90, 0.7);
  const setAssistHeight = (h: number) => setAssist((a) => ({ ...a, height: h }));
  const startAssistResize = (e: React.PointerEvent) => {
    if (!assist.collapsed) drag(e, assist.height, setAssistHeight, 160, 0.85);
  };

  const activeExampleId =
    project.module === "forward" ? project.forward.exampleId : project.module === "operator" ? project.operator.exampleId : project.module === "inverse" ? project.inverse.exampleId : project.mpc.exampleId;
  const sidebarEl = (
    <Sidebar
      module={project.module}
      onModule={(m) => setProject((p) => ({ ...p, module: m }))}
      caps={caps}
      examples={examples.filter((e) => e.modules.includes(project.module))}
      activeExample={activeExampleId}
      onExample={(ex) => {
        view.onExample(ex);
        setProject((p) => ({ ...p, name: ex.title }));
      }}
      jobs={jobs}
      activeJob={jobId}
      onDeleteJob={async (j) => {
        const name = `${j.label || j.kind} (${new Date(j.created_at).toLocaleString()})`;
        const model =
          j.kind === "operator_train" || j.kind === "mpc_train"
            ? "\n\nThis is a training run: its trained model is deleted with it, so it can no longer be used for predictions or MPC."
            : "";
        if (!window.confirm(`Delete run ${name}?${model}\n\nIts results and files are removed from disk.`)) return;
        try {
          await api.deleteJob(j.id);
          if (jobId === j.id) setJobId(null);
          setProject((p) => ({
            ...p,
            operator: p.operator.modelId === j.id ? { ...p.operator, modelId: null } : p.operator,
            mpc: p.mpc.surrogateId === j.id ? { ...p.mpc, surrogateId: null } : p.mpc,
          }));
          setNotice(`Deleted run ${name}.`);
        } catch (e) {
          setNotice(`Could not delete the run: ${(e as Error).message}`);
        }
        refreshJobs();
      }}
      onJob={(id) => {
        const j = jobs.find((x) => x.id === id);
        if (j) setProject((p) => ({ ...p, module: MODULE_OF[j.kind] ?? p.module }));
        if (j?.kind === "operator_train" && j.status === "completed") setProject((p) => ({ ...p, operator: { ...p.operator, modelId: id } }));
        if (j?.kind === "mpc_train" && j.status === "completed") setProject((p) => ({ ...p, mpc: { ...p.mpc, surrogateId: id } }));
        // a Forward run brings back the system it ran, so the editor matches the run on screen
        if (j?.kind === "forward")
          Promise.all([api.jobRequest(id), jobId ? api.jobRequest(jobId).catch(() => null) : null])
            .then(([{ payload }, shownReq]) => {
              const r = payload as ForwardRunRequest;
              const shown = shownReq?.kind === "forward" ? (shownReq.payload as ForwardRunRequest) : null;
              const f = project.forward;
              const current = forwardKey(f.system, f.time);
              if (current === forwardKey(r.system, r.time)) return;
              // ask only when the editor holds work that exists nowhere else: not an example, not what
              // was loaded from a run or last run, i.e. a system edited by hand or built by the AI
              if (
                f.exampleId === null &&
                current !== forwardSaved.current &&
                !(shown && current === forwardKey(shown.system, shown.time)) &&
                !window.confirm(
                  `Load the inputs of run ${id} (${r.system.name}) into the editor?\n\n` +
                    `The editor currently holds "${f.system.name}", which would be replaced. Choose Cancel to only view the run's results.`,
                )
              )
                return;
              setProject((p) => ({
                ...p,
                name: r.system.name,
                module: "forward",
                forward: { exampleId: null, system: r.system, time: r.time, options: { ...forwardDefaults, ...r.options }, reference: r.reference, plotStyle: p.forward.plotStyle },
              }));
              forwardSaved.current = forwardKey(r.system, r.time);
              setNotice(`Editor loaded from run ${id}.`);
            })
            .catch(() => {});
        setJobId(id);
      }}
    />
  );
  // every module's assistant can also restyle that module's figures (Plotly patches)
  const mod = project.module;
  const inner = view.assist;
  const figureIds = [
    ...FIGURE_IDS[mod],
    ...(mod === "forward" ? project.forward.system.states.map((s) => `trajectory_panel_${s.name}`) : []),
  ];
  const assistBinding = {
    ...inner,
    state: { ...inner.state, figure_style: figureStyle ?? {} },
    ask: (req: Parameters<typeof inner.ask>[0]) =>
      inner.ask({ ...req, figures: [...figuresOnScreen.current.values()], figure_ids: figureIds }),
    apply: ({ figure_style, ...rest }: { figure_style?: FigureStyle }) => {
      setProject((p) => ({
        ...p,
        figures: { ...p.figures, [mod]: figure_style && Object.keys(figure_style).length ? figure_style : undefined },
      }));
      inner.apply(rest);
    },
    keyLabels: { figure_style: "figure", ...inner.keyLabels },
  };
  const consoleEl = <Console status={job.status} log={job.log} pollError={job.error} />;
  const assistEl = (
    <AssistPanel
      key={project.module}
      binding={assistBinding}
      chat={chats[project.module]}
      setChat={(fn) => setChats((c) => ({ ...c, [project.module]: fn(c[project.module]) }))}
      disabled={conn !== "online"}
      collapsed={assist.collapsed}
      onCollapse={(collapsed) => setAssist((a) => ({ ...a, collapsed }))}
    />
  );

  return (
    <FigureStyleContext.Provider value={figureCtx}>
    <div className="flex flex-col h-full min-h-0">
      <Toolbar
        projectName={project.name}
        onRename={(name) => setProject((p) => ({ ...p, name }))}
        onNew={() => {
          setProject((p) => ({ ...blankProject(forwardDefaults), figures: p.figures }));
          setJobId(null);
          setNotice("New project.");
        }}
        onOpen={openFile}
        onSave={() => download(`${slug(project.name)}.adalib-studio.json`, serializeProject(project, jobId))}
        running={running}
        canRun={!runBlockReason}
        runBlockReason={runBlockReason}
        runLabel={view.runLabel}
        onRun={run}
        onStop={job.cancel}
        theme={theme.pref}
        onTheme={theme.setPref}
        plotStyle={plotStyle.style}
        onPlotStyle={plotStyle.setStyle}
        conn={conn}
        health={health}
        panels={panels}
        onTogglePanel={(k) => setPanels((p) => ({ ...p, [k]: !p[k] }))}
      />

      {conn === "offline" && (
        <div role="alert" className="px-3 py-1.5 text-[12.5px] bg-panel-2 border-b border-line text-bad">
          Cannot reach the ADALib Studio backend at /api. Start it with <code className="font-mono">scripts\start.ps1</code> (see README).
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center gap-2 px-3 py-1 text-[12.5px] bg-panel-2 border-b border-line text-ink-2">
          <span className="flex-1">{notice}</span>
          <Button variant="ghost" onClick={() => setNotice(null)} aria-label="Dismiss">
            Dismiss
          </Button>
        </div>
      )}

      {wide ? (
        <div className="flex flex-1 min-h-0">
          {panels.left && <aside className="w-[232px] shrink-0 bg-panel border-r border-line min-h-0">{sidebarEl}</aside>}
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <main className="flex-1 min-w-0 min-h-0 flex">
              <section aria-label="System definition" className="w-[400px] xl:w-[460px] shrink-0 bg-panel border-r border-line overflow-y-auto">
                {view.editor}
              </section>
              <section aria-label="Results" className="flex-1 min-w-0 min-h-0 bg-panel">
                {view.results}
              </section>
            </main>
            {panels.bottom && (
              <div className="shrink-0 bg-panel border-t border-line flex flex-col" style={{ height: consoleHeight }}>
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize console"
                  tabIndex={0}
                  onPointerDown={startResize}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp") setConsoleHeight((h) => Math.min(h + 20, window.innerHeight * 0.7));
                    if (e.key === "ArrowDown") setConsoleHeight((h) => Math.max(h - 20, 90));
                  }}
                  className="h-1.5 -mt-1 cursor-row-resize hover:bg-accent/40 shrink-0"
                />
                {consoleEl}
              </div>
            )}
          </div>
          {panels.right && (
            <aside className="w-[300px] shrink-0 bg-panel border-l border-line flex flex-col min-h-0">
              <div aria-label="Solver configuration" role="region" className="flex-1 min-h-0 overflow-y-auto">
                {view.config}
              </div>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize assistant"
                tabIndex={0}
                onPointerDown={startAssistResize}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") setAssistHeight(Math.min(assist.height + 20, window.innerHeight * 0.85));
                  if (e.key === "ArrowDown") setAssistHeight(Math.max(assist.height - 20, 160));
                }}
                className={`h-1.5 shrink-0 border-t border-line ${assist.collapsed ? "" : "cursor-row-resize hover:bg-accent/40"}`}
              />
              <section aria-label="AI assistant" className="shrink-0 flex flex-col min-h-0" style={assist.collapsed ? undefined : { height: assist.height }}>
                {assistEl}
              </section>
            </aside>
          )}
        </div>
      ) : (
        // narrow screens: one scrolling column, panels stacked in workflow order
        <div className="flex-1 min-h-0 overflow-y-auto bg-panel">
          {panels.left && <aside className="border-b border-line max-h-[60vh] overflow-y-auto">{sidebarEl}</aside>}
          <section aria-label="System definition" className="border-b border-line">{view.editor}</section>
          <section aria-label="Solver configuration" className="border-b border-line">{view.config}</section>
          <section aria-label="AI assistant" className={`border-b border-line flex flex-col ${assist.collapsed ? "" : "h-[480px]"}`}>
            {assistEl}
          </section>
          <section aria-label="Results" className="h-[560px] border-b border-line">{view.results}</section>
          {panels.bottom && <div className="h-[300px] flex flex-col">{consoleEl}</div>}
        </div>
      )}
    </div>
    </FigureStyleContext.Provider>
  );
}
