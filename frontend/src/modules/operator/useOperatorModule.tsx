import { useCallback, useEffect, useRef, useState } from "react";
import { Field, NumberField, Section } from "../../components/common/controls";
import { EmptyResults } from "../../components/common/EmptyResults";
import { SystemEditor } from "../../components/equations/SystemEditor";
import { useSystemValidation } from "../../hooks/hooks";
import { operatorFromExample, operatorIssues, operatorRequest, type OperatorProject } from "../../project";
import { api } from "../../services/api";
import type { OperatorBuiltin, OperatorManifest, OperatorPreset, OperatorTrainResult } from "../../types/api";
import { backendBlock, type ModuleContext, type ModuleView } from "../types";
import { BuiltinPanel, OperatorConfig } from "./OperatorConfig";
import { OperatorResults, type PredictionEntry } from "./OperatorResults";

export function useOperatorModule(ctx: ModuleContext): ModuleView {
  const p = ctx.project.operator;
  const active = ctx.project.module === "operator";
  const set = useCallback(
    (patch: Partial<OperatorProject>) =>
      ctx.setProject((pr) => ({
        ...pr,
        operator: { ...pr.operator, ...patch, exampleId: patch.system ? null : pr.operator.exampleId },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.setProject],
  );
  const { validation, validating } = useSystemValidation(p.system, ctx.conn, active && p.source === "custom");

  // ── catalog ─────────────────────────────────────────────────────────
  const [builtins, setBuiltins] = useState<OperatorBuiltin[]>([]);
  const [presets, setPresets] = useState<OperatorPreset[]>([]);
  useEffect(() => {
    if (ctx.conn !== "online" || builtins.length) return;
    api.operatorBuiltins().then((r) => {
      setBuiltins(r.systems);
      setPresets(r.presets);
    }).catch(() => {});
  }, [ctx.conn, builtins.length]);

  // ── trained models ──────────────────────────────────────────────────
  const [models, setModels] = useState<OperatorManifest[]>([]);
  const refreshModels = useCallback(() => api.operatorModels().then(setModels).catch(() => {}), []);
  useEffect(() => {
    if (ctx.conn === "online") refreshModels();
  }, [ctx.conn, refreshModels]);

  const model = models.find((m) => m.model_id === p.modelId) ?? models[0] ?? null;
  const [train, setTrain] = useState<OperatorTrainResult | null>(null);
  const [preds, setPreds] = useState<Record<string, PredictionEntry[]>>({});
  const [inputs, setInputs] = useState<{ model: string; x0: number[]; u: number[] } | null>(null);

  // a finished training job becomes the selected model
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const r = ctx.job.result;
    if (!r || !ctx.jobId || handled.current === ctx.jobId) return;
    if (r.kind === "operator_train") {
      handled.current = ctx.jobId;
      refreshModels().then(() => set({ modelId: r.model_id }));
    } else if (r.kind === "operator_infer") {
      handled.current = ctx.jobId;
      const id = ctx.jobId;
      setPreds((all) => {
        const list = all[r.model_id] ?? [];
        if (list.some((e) => e.id === id)) return all;
        const n = list.filter((e) => e.id !== "preview").length + 1;
        return { ...all, [r.model_id]: [...list, { id, label: `#${n}`, p: r }] };
      });
    }
  }, [ctx.job.result, ctx.jobId, refreshModels, set]);

  // load the training result (history, preview) of the selected model
  useEffect(() => {
    if (!model) return setTrain(null);
    let alive = true;
    api.result(model.model_id).then((r) => {
      if (!alive || r.kind !== "operator_train") return;
      setTrain(r);
      setPreds((all) => (all[model.model_id]?.length ? all : { ...all, [model.model_id]: [{ id: "preview", label: "preview", p: r.preview }] }));
    }).catch(() => alive && setTrain(null));
    return () => {
      alive = false;
    };
  }, [model?.model_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = model && inputs?.model === model.model_id ? inputs : model ? { model: model.model_id, x0: [...model.nominal.x0], u: [...model.nominal.inputs] } : null;

  const predict = async () => {
    if (!model || !cur) return;
    try {
      const { job_id } = await api.operatorInfer({ model_id: model.model_id, x0: cur.x0, inputs: cur.u, reference: true });
      ctx.showJob(job_id);
    } catch (e) {
      ctx.notify(`Prediction rejected: ${(e as Error).message}`);
    }
  };

  const blockReason =
    backendBlock(ctx) ??
    operatorIssues(p)[0] ??
    (p.source === "custom" ? (validation && !validation.ok ? "Fix the equation errors first" : validating || !validation ? "Validating equations…" : null) : null);

  const timeSection = (
    <Section title="Rollout">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Horizon T" htmlFor="op-T" hint="Each trajectory covers [0, T]">
          <NumberField id="op-T" label="Horizon" value={p.t_final} min={1e-12} onChange={(v) => set({ t_final: v })} />
        </Field>
        <Field label="Segments (n_seg)" htmlFor="op-nseg" hint="The operator predicts the state at the end of each segment">
          <NumberField id="op-nseg" label="Segments" integer min={1} value={p.n_seg} onChange={(v) => set({ n_seg: v })} />
        </Field>
      </div>
      <p className="mt-2 text-[11.5px] text-muted">
        Segment length {+(p.t_final / p.n_seg).toPrecision(4)}; controls are held constant over the rollout.
      </p>
    </Section>
  );

  return {
    runLabel: "Train",
    blockReason,
    run: async () => (await api.operatorTrain(operatorRequest(p, p.source === "custom" ? p.system.name : p.builtin))).job_id,
    onExample: (ex) => ctx.setProject((pr) => ({ ...pr, operator: operatorFromExample(ex, pr.operator) })),
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
        />
      ) : (
        <BuiltinPanel b={builtins.find((b) => b.id === p.builtin)} />
      ),
    config: <OperatorConfig p={p} set={set} builtins={builtins} presets={presets} />,
    results:
      model && cur ? (
        <OperatorResults
          models={models}
          model={model}
          onModel={(id) => set({ modelId: id })}
          train={train?.model_id === model.model_id ? train : null}
          predictions={preds[model.model_id] ?? []}
          x0={cur.x0}
          inputs={cur.u}
          onInputs={(x0, u) => setInputs({ model: model.model_id, x0, u })}
          onPredict={predict}
          predictBlock={backendBlock(ctx)}
          onRemove={(id) => setPreds((all) => ({ ...all, [model.model_id]: (all[model.model_id] ?? []).filter((e) => e.id !== id) }))}
          themeKey={ctx.themeKey}
        />
      ) : (
        <EmptyResults
          status={ctx.job.status?.kind === "operator_train" ? ctx.job.status : null}
          idle="No trained operator yet. Define a system (or pick a built-in benchmark), choose a training size and press Train."
          running="Training the operator… progress is in the console. Prediction opens when training finishes."
        />
      ),
  };
}
