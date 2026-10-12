import { useCallback } from "react";
import { canon, type AssistBinding } from "../../components/assist/AssistPanel";
import { EmptyResults } from "../../components/common/EmptyResults";
import { SystemEditor } from "../../components/equations/SystemEditor";
import { useSystemValidation } from "../../hooks/hooks";
import { inverseFromExample, inverseIssues, inverseRequest, inverseUnknown, type InverseProject, type InverseUnknown } from "../../project";
import { api } from "../../services/api";
import type { InverseOptions, SystemSpec, TimeSpan } from "../../types/api";
import { askModule, renamed } from "../assist";
import { backendBlock, type ModuleContext, type ModuleView } from "../types";

/** The Inverse setup as the assistant sees it (backend: llm_assist._parse_inverse). */
interface InverseAssistState {
  system: SystemSpec;
  time: TimeSpan;
  unknowns: Record<string, InverseUnknown>;
  data_source: InverseProject["dataSource"];
  synthetic: InverseProject["synthetic"];
  compare_to_values: boolean;
  options: InverseOptions;
  /** read-only: the uploaded file, if any */
  uploaded_file: string | null;
}
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
    assist: {
      label: "Inverse Solver",
      state: {
        system: p.system,
        time: p.time,
        unknowns: Object.fromEntries(p.system.parameters.map((q) => [q.name, inverseUnknown(p, q.name)])),
        data_source: p.dataSource,
        synthetic: p.synthetic,
        compare_to_values: p.compareToValues,
        options: p.options,
        uploaded_file: p.upload?.filename ?? null,
      },
      ask: askModule<InverseAssistState>("inverse"),
      apply: (s) =>
        ctx.setProject((pr) => {
          const same = canon([pr.inverse.system, pr.inverse.time]) === canon([s.system, s.time]);
          return {
            ...pr,
            name: renamed(pr.name, pr.inverse.system, s.system),
            inverse: {
              ...pr.inverse,
              system: s.system,
              time: s.time,
              unknowns: s.unknowns,
              dataSource: s.data_source,
              synthetic: s.synthetic,
              compareToValues: s.compare_to_values,
              options: s.options,
              exampleId: same ? pr.inverse.exampleId : null,
            },
          };
        }),
      keyLabels: { data_source: "data", compare_to_values: "compare" },
      intro:
        "Describe the model, which parameters to estimate and the observations in words, or attach a picture of the equations. " +
        "Parameter values are the true values for synthetic data. Review the setup, then press Estimate.",
      examples: [
        "Damped pendulum: estimate gamma from theta measured with 5 % noise",
        "Also estimate the second parameter, starting from half its value",
        "200 data points and 20 epochs",
      ],
      placeholder: "e.g. Lotka-Volterra, estimate alpha and delta from noisy data",
    } satisfies AssistBinding<InverseAssistState>,
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
