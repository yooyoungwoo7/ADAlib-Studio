import { useCallback, useEffect, useRef, useState } from "react";
import { Field, NumberField, Section } from "../../components/common/controls";
import { EmptyResults } from "../../components/common/EmptyResults";
import { SystemEditor } from "../../components/equations/SystemEditor";
import { useSystemValidation } from "../../hooks/hooks";
import { mpcFromExample, mpcLoopRequest, mpcRunIssues, mpcTrainIssues, mpcTrainRequest, surrogateMatches, type MPCProject } from "../../project";
import { api } from "../../services/api";
import type { MPCBuiltin, MPCSurrogate, OperatorPreset } from "../../types/api";
import { backendBlock, type ModuleContext, type ModuleView } from "../types";
import { BuiltinMPCPanel, MPCConfig, TrackingSection } from "./MPCPanels";
import { MPCResults, MPCTrainView } from "./MPCResults";

export function useMPCModule(ctx: ModuleContext): ModuleView {
  const p = ctx.project.mpc;
  const active = ctx.project.module === "mpc";
  const { validation, validating } = useSystemValidation(p.system, ctx.conn, active && p.source === "custom");
  const set = useCallback(
    (patch: Partial<MPCProject>) => ctx.setProject((pr) => ({ ...pr, mpc: { ...pr.mpc, ...patch, exampleId: patch.system ? null : pr.mpc.exampleId } })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.setProject],
  );
  const [builtins, setBuiltins] = useState<MPCBuiltin[]>([]);
  const [presets, setPresets] = useState<OperatorPreset[]>([]);
  useEffect(() => {
    if (ctx.conn !== "online" || builtins.length) return;
    api.mpcBuiltins().then((r) => {
      setBuiltins(r.systems);
      setPresets(r.presets);
    }).catch(() => {});
  }, [ctx.conn, builtins.length]);
  const builtin = builtins.find((b) => b.id === p.builtin);

  // ── trained surrogates ──────────────────────────────────────────────
  const [models, setModels] = useState<MPCSurrogate[]>([]);
  const refreshModels = useCallback(() => api.mpcModels().then(setModels).catch(() => {}), []);
  useEffect(() => {
    if (ctx.conn === "online") refreshModels();
  }, [ctx.conn, refreshModels]);
  const compatible = models.filter((m) => surrogateMatches(p, m));
  const surrogate = compatible.find((m) => m.model_id === p.surrogateId) ?? compatible[0] ?? null;

  // a finished training job becomes the selected surrogate
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const r = ctx.job.result;
    if (!r || !ctx.jobId || handled.current === ctx.jobId || r.kind !== "mpc_train") return;
    handled.current = ctx.jobId;
    refreshModels().then(() => set({ surrogateId: r.model_id }));
  }, [ctx.job.result, ctx.jobId, refreshModels, set]);

  const equationsBlock =
    p.source === "custom" ? (validation && !validation.ok ? "Fix the equation errors first" : validating || !validation ? "Validating equations…" : null) : null;
  const trainBlock =
    backendBlock(ctx) ?? mpcTrainIssues(p)[0] ?? (p.source === "builtin" && !builtin ? "Loading built-in systems…" : null) ?? equationsBlock;
  const blockReason =
    backendBlock(ctx) ??
    (p.source === "builtin" && !builtin ? "Loading built-in systems…" : null) ??
    equationsBlock ??
    (surrogate ? null : "Train a surrogate first (MPC panel → 1 · Surrogate)") ??
    mpcRunIssues(p)[0] ??
    null;

  const train = async () => {
    try {
      const { job_id } = await api.mpcTrain(mpcTrainRequest(p));
      ctx.showJob(job_id);
    } catch (e) {
      ctx.notify(`Training rejected: ${(e as Error).message}`);
    }
  };

  const timeSection = (
    <Section title="Control interval">
      <div className="grid grid-cols-2 gap-2">
        <Field label="dt (per MPC step)" htmlFor="mpc-dt" hint="The surrogate predicts one dt ahead, so changing dt needs a new surrogate">
          <NumberField id="mpc-dt" label="Control interval" min={1e-12} value={p.dt} onChange={(v) => set({ dt: v })} />
        </Field>
        <Field label="Closed-loop time" htmlFor="mpc-T">
          <input id="mpc-T" className="field mono" readOnly value={+(p.dt * p.options.n_steps).toPrecision(6)} />
        </Field>
      </div>
      <p className="mt-2 text-[11.5px] text-muted">The plant starts at the x₀ values in the state table above.</p>
    </Section>
  );

  const result = ctx.job.result;
  const status = ctx.job.status;
  return {
    runLabel: "Run MPC",
    blockReason,
    run: async () => (await api.runMpc(mpcLoopRequest(p, surrogate!, builtin))).job_id,
    onExample: (ex) => ctx.setProject((pr) => ({ ...pr, mpc: mpcFromExample(ex, pr.mpc) })),
    editor:
      p.source === "custom" ? (
        <SystemEditor
          variant="operator"
          system={p.system}
          onSystem={(system) => set({ system })}
          validation={validation}
          validating={validating}
          caps={ctx.caps}
          disabled={false}
          timeSection={timeSection}
          extra={<TrackingSection p={p} set={set} />}
        />
      ) : (
        <BuiltinMPCPanel b={builtin} p={p} set={set} />
      ),
    config: (
      <MPCConfig
        p={p}
        set={set}
        builtins={builtins}
        presets={presets}
        surrogates={compatible}
        hidden={models.length - compatible.length}
        surrogate={surrogate}
        onTrain={train}
        trainBlock={trainBlock}
      />
    ),
    results:
      result?.kind === "mpc" && ctx.jobId ? (
        <MPCResults key={ctx.jobId} jobId={ctx.jobId} r={result} themeKey={ctx.themeKey} />
      ) : result?.kind === "mpc_train" && ctx.jobId ? (
        <MPCTrainView key={ctx.jobId} r={result} themeKey={ctx.themeKey} />
      ) : (
        <EmptyResults
          status={status?.kind === "mpc" || status?.kind === "mpc_train" ? status : null}
          idle={
            surrogate
              ? "Surrogate ready. Choose the controllers in the MPC panel and press Run MPC — the closed loop reuses the trained surrogate, nothing is retrained."
              : "Set up the plant, then train a surrogate once (MPC panel → 1 · Surrogate). Run MPC then reuses it for every controller."
          }
          running={
            status?.kind === "mpc_train"
              ? "Training the surrogate… progress is in the console. It is saved for every later closed-loop run."
              : "Running the closed loop on the trained surrogate (see the console)."
          }
        />
      ),
  };
}
