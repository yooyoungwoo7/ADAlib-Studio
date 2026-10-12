import { useEffect, useRef, useState } from "react";
import { AssistChat, type ChatEntry } from "../../components/assist/AssistChat";
import { ForwardConfig } from "../../components/configuration/ForwardConfig";
import { SystemEditor } from "../../components/equations/SystemEditor";
import { EmptyResults } from "../../components/common/EmptyResults";
import { useSystemValidation } from "../../hooks/hooks";
import { forwardFromExample, forwardRequest, localIssues, type ForwardProject } from "../../project";
import { api } from "../../services/api";
import type { ForwardRunRequest, PlotStyle } from "../../types/api";
import { backendBlock, type ModuleContext, type ModuleView } from "../types";
import { ForwardResults } from "./ForwardResults";

// The figure style is remembered per browser (like the theme), so it survives closing Studio.
// Storage can be unavailable (private mode); the project file still carries the style.
const STYLE_KEY = "adalib-studio-figure-style";
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

  // AI assistant chat; kept here so it survives switching modules
  const [chat, setChat] = useState<ChatEntry[]>([]);

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
      <>
        <ForwardConfig
          options={p.options}
          defaults={ctx.forwardDefaults}
          onChange={(options) => set({ options })}
          reference={p.reference}
          onReference={(reference) => set({ reference })}
          disabled={false}
        />
        <AssistChat
          system={p.system}
          time={p.time}
          options={p.options}
          plotStyle={p.plotStyle}
          onApply={({ system, time, options, plotStyle }) =>
            ctx.setProject((pr) => {
              // a figure-only answer keeps the example selection
              const same = JSON.stringify([pr.forward.system, pr.forward.time]) === JSON.stringify([system, time]);
              return {
                ...pr,
                name: same ? pr.name : system.name,
                forward: { ...pr.forward, system, time, options, plotStyle, exampleId: same ? pr.forward.exampleId : null },
              };
            })
          }
          chat={chat}
          setChat={setChat}
          disabled={ctx.conn !== "online"}
        />
      </>
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
          onResetStyle={() => set({ plotStyle: undefined })}
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
