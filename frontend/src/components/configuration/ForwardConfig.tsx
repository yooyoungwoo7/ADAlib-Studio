import type { ForwardOptions } from "../../types/api";
import { Button, Field, NumberField, Section } from "../common/controls";

const HINTS: Record<keyof ForwardOptions, string> = {
  basis: "'adaf' = Adaptive Fourier, piecewise sequential; 'lpa' = Legendre polynomial, full domain",
  n_seg: "Number of sequential time segments (ADA-F only)",
  N_p: "Fourier / Legendre mode count",
  N_m: "Fourier mode truncation (ADA-F only)",
  Nt_total: "Total collocation points across the domain (= points in the returned trajectory)",
  epochs: "Adam outer epochs (per segment for ADA-F)",
  adam_inner: "Adam gradient steps per epoch and equation",
  adam_lr: "Adam learning rate",
  use_lbfgs: "L-BFGS polish after Adam",
  dtype: "Floating-point precision used for training",
  gamma: "ADA-F / LPA time-scale parameter",
  L: "ADA-F shift parameter",
  order: "LPA polynomial order",
};

export function ForwardConfig({
  options,
  defaults,
  onChange,
  reference,
  onReference,
  disabled,
}: {
  options: ForwardOptions;
  defaults: ForwardOptions;
  onChange: (o: ForwardOptions) => void;
  reference: boolean;
  onReference: (v: boolean) => void;
  disabled: boolean;
}) {
  const set = <K extends keyof ForwardOptions>(k: K, v: ForwardOptions[K]) => onChange({ ...options, [k]: v });
  const adaf = options.basis === "adaf";
  const int = (k: keyof ForwardOptions, label: string, min = 1, show = true) =>
    show && (
      <Field label={label} hint={HINTS[k]} htmlFor={`opt-${k}`}>
        <NumberField id={`opt-${k}`} label={label} integer min={min} value={options[k] as number} onChange={(v) => set(k, v as never)} />
      </Field>
    );
  const changed = (Object.keys(defaults) as (keyof ForwardOptions)[]).filter((k) => defaults[k] !== options[k]);

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <Section title="Forward solver">
        <p className="text-[12px] text-ink-2 mb-3 leading-snug">
          Runs <code className="font-mono text-[11.5px]">adalib.run_forward</code> on your system. Training is
          physics-informed: the ADA basis is fitted to minimise the ODE residual.
        </p>
        <div className="flex flex-col gap-2.5">
          <Field label="Basis" hint={HINTS.basis} htmlFor="opt-basis">
            <select id="opt-basis" className="field" value={options.basis} onChange={(e) => set("basis", e.target.value as ForwardOptions["basis"])}>
              <option value="adaf">ADA-F — adaptive Fourier, sequential segments</option>
              <option value="lpa">LPA — Legendre polynomial, full domain</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {int("n_seg", "Segments (n_seg)", 1, adaf)}
            {int("Nt_total", "Grid points (Nt_total)", 2)}
            {int("epochs", "Adam epochs", 0)}
            {int("adam_inner", "Adam steps / epoch")}
          </div>
          {adaf && options.Nt_total % options.n_seg !== 0 && (
            <p role="alert" className="text-bad text-[12px]">
              Nt_total must be divisible by n_seg ({options.Nt_total} / {options.n_seg} is not an integer).
            </p>
          )}
          <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" title={HINTS.use_lbfgs}>
            <input type="checkbox" checked={options.use_lbfgs} onChange={(e) => set("use_lbfgs", e.target.checked)} />
            L-BFGS refinement after Adam
          </label>
        </div>
      </Section>

      <Section title="Advanced" collapsible defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          {int("N_p", "Modes (N_p)")}
          {int("N_m", "Truncation (N_m)", 1, adaf)}
          {int("order", "LPA order", 1, !adaf)}
          <Field label="Adam learning rate" hint={HINTS.adam_lr} htmlFor="opt-lr">
            <NumberField id="opt-lr" label="Adam learning rate" value={options.adam_lr} onChange={(v) => set("adam_lr", v)} />
          </Field>
          <Field label="gamma" hint={HINTS.gamma} htmlFor="opt-gamma">
            <NumberField id="opt-gamma" label="gamma" value={options.gamma} onChange={(v) => set("gamma", v)} />
          </Field>
          {adaf && (
            <Field label="L" hint={HINTS.L} htmlFor="opt-L">
              <NumberField id="opt-L" label="L" value={options.L} onChange={(v) => set("L", v)} />
            </Field>
          )}
          <Field label="Precision" hint={HINTS.dtype} htmlFor="opt-dtype">
            <select id="opt-dtype" className="field" value={options.dtype} onChange={(e) => set("dtype", e.target.value as ForwardOptions["dtype"])}>
              <option value="float64">float64</option>
              <option value="float32">float32</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-muted">
            {changed.length ? `${changed.length} changed from adalib defaults` : "All adalib defaults"}
          </span>
          <Button variant="ghost" disabled={!changed.length} onClick={() => onChange({ ...defaults })}>
            Reset to defaults
          </Button>
        </div>
      </Section>

      <Section title="Verification">
        <label className="flex items-start gap-2 text-[12.5px] cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={reference} onChange={(e) => onReference(e.target.checked)} />
          <span>
            Compare with a numerical reference
            <span className="block text-[11.5px] text-muted leading-snug mt-0.5">
              scipy BDF via <code className="font-mono">adalib.utils.reference</code>. Plotted as a separate, labelled line; it
              never replaces the ADA result.
            </span>
          </span>
        </label>
      </Section>
    </fieldset>
  );
}
