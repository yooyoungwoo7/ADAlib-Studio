import { useEffect, useRef, useState } from "react";
import { canon, type AssistBinding } from "../../components/assist/AssistPanel";
import type { FigureStyle } from "../../plots/figureStyle";
import { ForwardConfig } from "../../components/configuration/ForwardConfig";
import { SystemEditor } from "../../components/equations/SystemEditor";
import { EmptyResults } from "../../components/common/EmptyResults";
import { useSystemValidation } from "../../hooks/hooks";
import { forwardFromExample, forwardRequest, localIssues, type ForwardProject } from "../../project";
import { api } from "../../services/api";
import type { ForwardOptions, ForwardRunRequest, PlotStyle, SystemSpec, TimeSpan } from "../../types/api";
import { backendBlock, type ModuleContext, type ModuleView } from "../types";
import { ForwardResults } from "./ForwardResults";

// The figure style is remembered per browser (like the theme), so it survives closing Studio.
// Storage can be unavailable (private mode); the project file still carries the style.
const STYLE_KEY = "adalib-studio-figure-style";

/** What the assistant can change here: the system, its time span, the solver options and the figure style. */
interface ForwardAssistState {
  system: SystemSpec;
  time: TimeSpan;
  options: ForwardOptions;
  plotStyle?: PlotStyle;
  /** added by the App shell: the module's free-form figure style */
  figure_style?: FigureStyle;
}
function savedStyle(): PlotStyle | undefined {
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && typeof s === "object" && !Array.isArray(s) && Object.keys(s).length ? (s as PlotStyle) : undefined;
  } catch {
    return undefined;
  }
}

export function useForwardModule(ctx: ModuleContext): ModuleView {
  const p = ctx.project.forward;
  const active = ctx.project.module === "forward";
  const { validation, validating } = useSystemValidation(p.system, ctx.conn, active);
  const set = (patch: Partial<ForwardProject>) =>
    ctx.setProject((pr) => ({
      ...pr,
      forward: { ...pr.forward, ...patch, exampleId: patch.system || patch.time ? null : pr.forward.exampleId },
    }));

  // restore the remembered figure style once, then keep the browser copy in step with the project
  const styleRestored = useRef(false);
  useEffect(() => {
    if (styleRestored.current) return;
    styleRestored.current = true;
    const s = savedStyle();
    if (s && !p.plotStyle) set({ plotStyle: s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const styleSynced = useRef(false);
  useEffect(() => {
    if (!styleSynced.current) {
      styleSynced.current = true; // the first render has not seen the restored style yet
      return;
    }
    try {
      if (p.plotStyle && Object.keys(p.plotStyle).length) localStorage.setItem(STYLE_KEY, JSON.stringify(p.plotStyle));
      else localStorage.removeItem(STYLE_KEY);
    } catch {
      /* not remembered */
    }
  }, [p.plotStyle]);

  // the request behind the job on screen, for "Config JSON" and "Restore inputs"
  const [jobRequest, setJobRequest] = useState<ForwardRunRequest | null>(null);
  const shown = ctx.job.result?.kind === "forward" ? ctx.job.result : null;
  useEffect(() => {
    if (!ctx.jobId || !shown) return setJobRequest(null);
    api.jobRequest(ctx.jobId).then((r) => setJobRequest(r.payload as ForwardRunRequest)).catch(() => setJobRequest(null));
  }, [ctx.jobId, shown]);

  const blockReason =
    backendBlock(ctx) ??
    localIssues(p)[0] ??
    (validation && !validation.ok ? "Fix the equation errors first" : validating || !validation ? "Validating equations…" : null);

  const restore = () => {
    if (!jobRequest) return;
    ctx.setProject((pr) => ({
      ...pr,
      module: "forward",
      forward: {
        exampleId: null,
        system: jobRequest.system,
        time: jobRequest.time,
        options: { ...ctx.forwardDefaults, ...jobRequest.options },
        reference: jobRequest.reference,
        plotStyle: pr.forward.plotStyle,
      },
    }));
    ctx.notify(`Inputs restored from run ${ctx.jobId}.`);
  };

  return {
    runLabel: "Run",
    blockReason,
    run: async () => (await api.runForward(forwardRequest(p))).job_id,
    assist: {
      label: "Forward Solver",
      state: { system: p.system, time: p.time, options: p.options, plotStyle: p.plotStyle },
      ask: async ({ prompt, images, state, history, language, figures, figure_ids, figure_system }) => {
        const r = await api.assistForward({
          prompt,
          images,
          current_system: state.system,
          current_time: state.time,
          current_options: state.options,
          current_plot_style: state.plotStyle,
          current_figure_style: state.figure_style,
          figures,
          figure_ids,
          figure_system,
          history,
          language,
        });
        const plotStyle = Object.keys(r.plot_style ?? {}).length ? r.plot_style : undefined;
        return {
          state: { system: r.system, time: r.time, options: r.options, plotStyle, figure_style: r.figure_style },
          reply: r.reply,
          model: r.model,
          attempts: r.attempts,
        };
      },
      apply: ({ system, time, options, plotStyle }) =>
        ctx.setProject((pr) => {
          // a figure- or solver-only answer keeps the example selection
          const same = canon([pr.forward.system, pr.forward.time]) === canon([system, time]);
          return {
            ...pr,
            name: same ? pr.name : system.name,
            forward: { ...pr.forward, system, time, options, plotStyle, exampleId: same ? pr.forward.exampleId : null },
          };
        }),
      keyLabels: { plotStyle: "figure", options: "solver" },
      intro:
        "Describe the system, the solver settings or the figure style in words, or attach a picture of the equations (paste, drop or 📎). " +
        "Changes are checked before they apply; figure changes show at once, the rest after Run.",
      examples: [
        "Damped pendulum, gamma = 0.5, for 10 s",
        "Use 100 segments and turn off L-BFGS",
        "Paper figure: Times 10 pt, first state in red, x axis 'Time [s]', 8 x 6 cm at 600 dpi",
      ],
      placeholder: "e.g. Van der Pol oscillator with mu = 2, x(0) = 1, for 20 s",
    } satisfies AssistBinding<ForwardAssistState>,
    onExample: (ex) => ctx.setProject((pr) => ({ ...pr, forward: { ...forwardFromExample(ex, ctx.forwardDefaults), plotStyle: pr.forward.plotStyle } })),
    editor: (
      <SystemEditor
        system={p.system}
        time={p.time}
        onSystem={(system) => set({ system })}
        onTime={(time) => set({ time })}
        validation={validation}
        validating={validating}
        caps={ctx.caps}
        disabled={false}
      />
    ),
    config: (
      <ForwardConfig
        options={p.options}
        defaults={ctx.forwardDefaults}
        onChange={(options) => set({ options })}
        reference={p.reference}
        onReference={(reference) => set({ reference })}
        disabled={false}
      />
    ),
    results:
      shown && ctx.jobId ? (
        <ForwardResults
          key={ctx.jobId}
          jobId={ctx.jobId}
          result={shown}
          request={jobRequest}
          themeKey={ctx.themeKey}
          onRestore={jobRequest ? restore : undefined}
          plotStyle={p.plotStyle}
          figureStyled={!!ctx.project.figures?.forward && Object.keys(ctx.project.figures.forward).length > 0}
          onResetStyle={() => ctx.setProject((pr) => ({ ...pr, forward: { ...pr.forward, plotStyle: undefined }, figures: { ...pr.figures, forward: undefined } }))}
        />
      ) : (
        <EmptyResults
          status={ctx.job.status?.kind === "forward" ? ctx.job.status : null}
          idle="Results appear here after a run. Load an example or define your own system, then press Run."
          running="Running… the ADA solver is training. Trajectories appear when it finishes."
        />
      ),
  };
}
