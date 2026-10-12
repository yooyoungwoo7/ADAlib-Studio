import { Button, Field, NumberField, Section } from "../../components/common/controls";
import { OPERATOR_DEFAULTS, type OperatorProject } from "../../project";
import type { OperatorBuiltin, OperatorOptions, OperatorPreset } from "../../types/api";

const HINT: Partial<Record<keyof OperatorOptions, string>> = {
  n_train: "Training samples: (x0, u) pairs for custom systems, full trajectories for built-ins",
  n_val: "Validation samples",
  epochs: "Training epochs",
  batch_size: "Mini-batch size",
  lr: "Peak learning rate",
  hidden: "Width of the operator network",
  n_layers: "Depth of the operator network",
  seed: "Random seed for sampling",
  lpa_n_panels: "LPA panels per segment (custom path)",
  lpa_max_order: "Maximum LPA polynomial order (custom path)",
  lpa_nt_seg: "Collocation points per segment (custom path)",
};

export function OperatorConfig({
  p,
  set,
  builtins,
  presets,
}: {
  p: OperatorProject;
  set: (patch: Partial<OperatorProject>) => void;
  builtins: OperatorBuiltin[];
  presets: OperatorPreset[];
}) {
  const o = p.options;
  const setOpt = (patch: Partial<OperatorOptions>) => set({ options: { ...o, ...patch }, presetId: null });
  const int = (k: keyof OperatorOptions, label: string, min = 1) => (
    <Field label={label} hint={HINT[k]} htmlFor={`op-${k}`}>
      <NumberField id={`op-${k}`} label={label} integer min={min} value={o[k] as number} onChange={(v) => setOpt({ [k]: v })} />
    </Field>
  );
  const builtin = builtins.find((b) => b.id === p.builtin);

  return (
    <div className="min-w-0">
      <Section title="Operator learning">
        <p className="text-[12px] text-ink-2 mb-3 leading-snug">
          Trains a reusable surrogate with <code className="font-mono text-[11.5px]">adalib.run_operator</code>.
          Prediction afterwards reloads the trained model — nothing is retrained.
        </p>
        <div role="radiogroup" aria-label="System source" className="grid grid-cols-2 gap-1 p-0.5 bg-panel-3 rounded">
          {(["custom", "builtin"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={p.source === s}
              onClick={() => set({ source: s })}
              className={`h-7 rounded text-[12.5px] cursor-pointer ${p.source === s ? "bg-panel text-ink font-medium shadow-sm" : "text-ink-2 hover:text-ink"}`}
            >
              {s === "custom" ? "Custom equations" : "Built-in benchmark"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-muted leading-snug">
          {p.source === "custom"
            ? "Generic path: physics-residual-only LPA operator over your training box (no simulated data)."
            : "Legacy path: data + physics training on adalib's own problem, time grid and ranges."}
        </p>
        {p.source === "builtin" && (
          <div className="mt-3">
            <Field label="System" htmlFor="op-builtin">
              <select id="op-builtin" className="field" value={p.builtin} onChange={(e) => set({ builtin: e.target.value as OperatorProject["builtin"] })}>
                {builtins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </Field>
            {builtin && <p className="mt-1.5 text-[11.5px] text-muted">Time grid: {builtin.time}</p>}
          </div>
        )}
      </Section>

      <Section title="Training size">
        <div className="flex flex-wrap gap-1 mb-3" role="group" aria-label="Presets">
          {presets.map((pr) => (
            <Button
              key={pr.id}
              variant={p.presetId === pr.id ? "primary" : "default"}
              title={pr.note}
              aria-pressed={p.presetId === pr.id}
              onClick={() => set({ options: { ...o, ...pr.options }, presetId: pr.id })}
            >
              {pr.title}
            </Button>
          ))}
        </div>
        {p.presetId && <p className="-mt-1.5 mb-2.5 text-[11.5px] text-muted">{presets.find((x) => x.id === p.presetId)?.note}</p>}
        <div className="grid grid-cols-2 gap-2">
          {int("n_train", "Train samples", 2)}
          {int("n_val", "Validation samples")}
          {int("epochs", "Epochs")}
          {int("batch_size", "Batch size")}
          {int("hidden", "Hidden width", 4)}
          {int("n_layers", "Layers")}
        </div>
      </Section>

      <Section title="Advanced" collapsible defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Learning rate" hint={HINT.lr} htmlFor="op-lr">
            <NumberField id="op-lr" label="Learning rate" value={o.lr} onChange={(v) => setOpt({ lr: v })} />
          </Field>
          {int("seed", "Seed", 0)}
          {p.source === "custom" ? (
            <>
              {int("lpa_n_panels", "LPA panels")}
              {int("lpa_max_order", "LPA max order")}
              {int("lpa_nt_seg", "Points / segment", 4)}
            </>
          ) : (
            <>
              <Field label="Basis" htmlFor="op-basis">
                <select id="op-basis" className="field" value={o.basis} onChange={(e) => setOpt({ basis: e.target.value as OperatorOptions["basis"] })}>
                  <option value="lpa">LPA</option>
                  <option value="adaf">ADA-F</option>
                </select>
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-[12.5px] cursor-pointer">
                <input type="checkbox" checked={o.use_lr_schedule} onChange={(e) => setOpt({ use_lr_schedule: e.target.checked })} />
                Cosine warm-up learning-rate schedule
              </label>
            </>
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" onClick={() => set({ options: { ...OPERATOR_DEFAULTS }, presetId: "adalib" })}>
            Reset to adalib defaults
          </Button>
        </div>
      </Section>
    </div>
  );
}

export function BuiltinPanel({ b }: { b: OperatorBuiltin | undefined }) {
  if (!b) return <p className="p-4 text-muted">Loading built-in systems…</p>;
  return (
    <div className="p-3 flex flex-col gap-3 text-[12.5px]">
      <h2 className="text-[14px] font-semibold">{b.title}</h2>
      <p className="text-ink-2 leading-relaxed">{b.description}</p>
      <div>
        <h3 className="panel-title mb-1">States</h3>
        <p className="font-mono">{b.states.join(", ")}</p>
      </div>
      <div>
        <h3 className="panel-title mb-1">Inputs θ and training ranges</h3>
        <table className="font-mono tabular-nums">
          <tbody>
            {b.inputs.map((n, i) => (
              <tr key={n}>
                <td className="pr-4">{n}</td>
                <td className="text-ink-2">
                  [{b.input_ranges[i][0]}, {b.input_ranges[i][1]}]
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-muted">
        Equations, time grid and sampling ranges come from adalib ({b.source}). They are not editable here — use
        Custom equations to change the model. The exact ranges of a trained model are re-read from the installed package.
      </p>
    </div>
  );
}
