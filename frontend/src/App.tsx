import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./components/common/controls";
import { Console } from "./components/layout/Console";
import { Sidebar } from "./components/layout/Sidebar";
import { Toolbar } from "./components/layout/Toolbar";
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
import type { Example, ForwardOptions, JobKind, JobStatus, ModuleId } from "./types/api";

const MODULE_OF: Record<JobKind, ModuleId> = {
  forward: "forward",
  operator_train: "operator",
  operator_infer: "operator",
  inverse: "inverse",
  mpc: "mpc",
  mpc_train: "mpc",
};

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

  const [project, setProjectState] = useState<Project>(() => blankProject(FALLBACK_FORWARD_DEFAULTS));
  const setProject = useCallback((fn: (p: Project) => Project) => setProjectState(fn), []);
  const [examples, setExamples] = useState<Example[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [panels, setPanels] = useState(() => ({ left: window.innerWidth >= 1024, right: true, bottom: true }));
  const [consoleHeight, setConsoleHeight] = useState(210);

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
          forward: first ? forwardFromExample(first, forwardDefaults) : p.forward,
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

  const run = useCallback(async () => {
    if (runBlockReason || running) return;
    setNotice(null);
    try {
      showJob(await view.run());
    } catch (e) {
      setNotice(`Run rejected: ${(e as Error).message}`);
    }
  }, [view, runBlockReason, running, showJob]);

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
      setProject(() => pf.project);
      setJobId(pf.last_job_id && jobs.some((j) => j.id === pf.last_job_id) ? pf.last_job_id : null);
      setNotice(`Opened "${pf.project.name}".`);
    } catch (e) {
      setNotice(`Could not open ${f.name}: ${(e as Error).message}`);
    }
  };

  // ── console resize ───────────────────────────────────────────────────
  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = consoleHeight;
    const move = (ev: PointerEvent) => setConsoleHeight(Math.min(Math.max(h0 - (ev.clientY - y0), 90), window.innerHeight * 0.7));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
      onExample={(ex) => view.onExample(ex)}
      jobs={jobs}
      activeJob={jobId}
      onJob={(id) => {
        const j = jobs.find((x) => x.id === id);
        if (j) setProject((p) => ({ ...p, module: MODULE_OF[j.kind] ?? p.module }));
        if (j?.kind === "operator_train" && j.status === "completed") setProject((p) => ({ ...p, operator: { ...p.operator, modelId: id } }));
        if (j?.kind === "mpc_train" && j.status === "completed") setProject((p) => ({ ...p, mpc: { ...p.mpc, surrogateId: id } }));
        setJobId(id);
      }}
    />
  );
  const consoleEl = <Console status={job.status} log={job.log} pollError={job.error} />;

  return (
    <div className="flex flex-col h-full min-h-0">
      <Toolbar
        projectName={project.name}
        onRename={(name) => setProject((p) => ({ ...p, name }))}
        onNew={() => {
          setProject(() => blankProject(forwardDefaults));
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
            <div className="flex flex-1 min-h-0">
              <main className="flex-1 min-w-0 min-h-0 flex">
                <section aria-label="System definition" className="w-[400px] xl:w-[460px] shrink-0 bg-panel border-r border-line overflow-y-auto">
                  {view.editor}
                </section>
                <section aria-label="Results" className="flex-1 min-w-0 min-h-0 bg-panel">
                  {view.results}
                </section>
              </main>
              {panels.right && (
                <aside aria-label="Solver configuration" className="w-[300px] shrink-0 bg-panel border-l border-line overflow-y-auto">
                  {view.config}
                </aside>
              )}
            </div>
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
        </div>
      ) : (
        // narrow screens: one scrolling column, panels stacked in workflow order
        <div className="flex-1 min-h-0 overflow-y-auto bg-panel">
          {panels.left && <aside className="border-b border-line max-h-[60vh] overflow-y-auto">{sidebarEl}</aside>}
          <section aria-label="System definition" className="border-b border-line">{view.editor}</section>
          <section aria-label="Solver configuration" className="border-b border-line">{view.config}</section>
          <section aria-label="Results" className="h-[560px] border-b border-line">{view.results}</section>
          {panels.bottom && <div className="h-[300px] flex flex-col">{consoleEl}</div>}
        </div>
      )}
    </div>
  );
}
