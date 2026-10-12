import { useCallback } from "react";
import { EmptyResults } from "../../components/common/EmptyResults";
import { SystemEditor } from "../../components/equations/SystemEditor";
import { useSystemValidation } from "../../hooks/hooks";
import { inverseFromExample, inverseIssues, inverseRequest, type InverseProject } from "../../project";
import { api } from "../../services/api";
import { backendBlock, type ModuleContext, type ModuleView } from "../types";
import { InverseConfig } from "./InverseConfig";
import { InverseResults } from "./InverseResults";
import { InverseSetup, uploadBlock } from "./InverseSetup";

export function useInverseModule(ctx: ModuleContext): ModuleView {
  const p = ctx.project.inverse;
  const active = ctx.project.module === "inverse";
  const { validation, validating } = useSystemValidation(p.system, ctx.conn, active);
  const set = useCallback(
    (patch: Partial<InverseProject>) =>
      ctx.setProject((pr) => ({ ...pr, inverse: { ...pr.inverse, ...patch, exampleId: patch.system ? null : pr.inverse.exampleId } })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.setProject],
  );
  const shown = ctx.job.result?.kind === "inverse" ? ctx.job.result : null;

  const blockReason =
    backendBlock(ctx) ??
    inverseIssues(p)[0] ??
    uploadBlock(p) ??
    (validation && !validation.ok ? "Fix the equation errors first" : validating || !validation ? "Validating equations…" : null);

  return {
    runLabel: "Estimate",
    blockReason,
    run: async () => (await api.runInverse(inverseRequest(p))).job_id,
    onExample: (ex) => ctx.setProject((pr) => ({ ...pr, inverse: inverseFromExample(ex) })),
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
        extra={<InverseSetup p={p} set={set} notify={ctx.notify} />}
      />
    ),
    config: <InverseConfig o={p.options} onChange={(options) => set({ options })} />,
    results:
      shown && ctx.jobId ? (
        <InverseResults key={ctx.jobId} jobId={ctx.jobId} r={shown} themeKey={ctx.themeKey} />
      ) : (
        <EmptyResults
          status={ctx.job.status?.kind === "inverse" ? ctx.job.status : null}
          idle="Define the model, tick the parameters to estimate, choose observations and press Estimate."
          running="Estimating… the console shows each segment's loss and the current parameter values."
        />
      ),
  };
}
