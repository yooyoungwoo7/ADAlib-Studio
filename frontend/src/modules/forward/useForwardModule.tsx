import { useEffect, useState } from "react";
import { AssistChat, type ChatEntry } from "../../components/assist/AssistChat";
import { ForwardConfig } from "../../components/configuration/ForwardConfig";
import { SystemEditor } from "../../components/equations/SystemEditor";
import { EmptyResults } from "../../components/common/EmptyResults";
import { useSystemValidation } from "../../hooks/hooks";
import { forwardFromExample, forwardRequest, localIssues, type ForwardProject } from "../../project";
import { api } from "../../services/api";
import type { ForwardRunRequest } from "../../types/api";
import { backendBlock, type ModuleContext, type ModuleView } from "../types";
import { ForwardResults } from "./ForwardResults";

export function useForwardModule(ctx: ModuleContext): ModuleView {
  const p = ctx.project.forward;
  const active = ctx.project.module === "forward";
  const { validation, validating } = useSystemValidation(p.system, ctx.conn, active);
  const set = (patch: Partial<ForwardProject>) =>
    ctx.setProject((pr) => ({
      ...pr,
      forward: { ...pr.forward, ...patch, exampleId: patch.system || patch.time ? null : pr.forward.exampleId },
    }));

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
