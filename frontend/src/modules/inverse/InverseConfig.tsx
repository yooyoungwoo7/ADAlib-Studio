import { Button, Field, NumberField, Section } from "../../components/common/controls";
import { INVERSE_DEFAULTS } from "../../project";
import type { InverseOptions } from "../../types/api";

export function InverseConfig({ o, onChange }: { o: InverseOptions; onChange: (o: InverseOptions) => void }) {
  const set = (patch: Partial<InverseOptions>) => onChange({ ...o, ...patch });
  const int = (k: keyof InverseOptions, label: string, min = 1, hint?: string) => (
    <Field label={label} hint={hint} htmlFor={`inv-${k}`}>
      <NumberField id={`inv-${k}`} label={label} integer min={min} value={o[k] as number} onChange={(v) => set({ [k]: v })} />
    </Field>
  );
  const num = (k: keyof InverseOptions, label: string, hint?: string) => (
    <Field label={label} hint={hint} htmlFor={`inv-${k}`}>
      <NumberField id={`inv-${k}`} label={label} value={o[k] as number} onChange={(v) => set({ [k]: v })} />
    </Field>
  );
  return (
    <div className="min-w-0">
      <Section title="Inverse solver">
        <p className="text-[12px] text-ink-2 mb-3 leading-snug">
          Runs <code className="font-mono text-[11.5px]">adalib.run_inverse</code>: sequential ADA-F segments, trained
          jointly on the ODE residual and the data misfit while the unknown parameters are updated.
        </p>
        <div className="flex flex-col gap-2.5">
          <Field label="Training strategy" htmlFor="inv-strategy" hint="joint: Adam on weights and parameters together; alternating: weights and parameters in turn">
            <select id="inv-strategy" className="field" value={o.training_strategy} onChange={(e) => set({ training_strategy: e.target.value as InverseOptions["training_strategy"] })}>
              <option value="joint">Joint (weights + parameters)</option>
              <option value="alternating">Alternating</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {int("n_seg", "Segments (n_seg)")}
            {int("Nt_total", "Grid points", 2, "Truncated by adalib to a multiple of n_seg")}
            {int("epochs", "Adam epochs", 0)}
            {int("adam_inner", "Adam steps / epoch")}
            {num("lambda_physics", "λ physics", "Weight of the ODE residual")}
            {num("lambda_data", "λ data", "Weight of the data misfit")}
          </div>
          <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" title="Joint L-BFGS-B polish per segment; dominates the runtime">
            <input type="checkbox" checked={o.use_lbfgs} onChange={(e) => set({ use_lbfgs: e.target.checked })} />
            L-BFGS refinement per segment
          </label>
        </div>
      </Section>
      <Section title="Advanced" collapsible defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          {int("N_p", "Modes (N_p)")}
          {int("N_m", "Truncation (N_m)")}
          {num("gamma", "gamma (basis)", "ADA-F time-scale parameter, not a model parameter")}
          {num("L", "L")}
          {num("adam_lr", "Adam learning rate")}
          {int("n_passes", "Sequential passes")}
          {int("warm_seg_passes", "Warm passes")}
          {int("n_warm_segs", "Warm segments", 0)}
          {int("data_prefit_steps", "Data prefit steps", 0)}
          <Field label="Precision" htmlFor="inv-dtype">
            <select id="inv-dtype" className="field" value={o.dtype} onChange={(e) => set({ dtype: e.target.value as InverseOptions["dtype"] })}>
              <option value="float64">float64</option>
              <option value="float32">float32</option>
            </select>
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-[12.5px] cursor-pointer">
            <input type="checkbox" checked={o.normalize_data_loss} onChange={(e) => set({ normalize_data_loss: e.target.checked })} />
            Normalise data loss
          </label>
          <label className="col-span-2 flex items-center gap-2 text-[12.5px] cursor-pointer">
            <input type="checkbox" checked={o.normalize_physics_loss} onChange={(e) => set({ normalize_physics_loss: e.target.checked })} />
            Normalise physics loss
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" onClick={() => onChange({ ...INVERSE_DEFAULTS })}>
            Reset to adalib defaults
          </Button>
        </div>
      </Section>
    </div>
  );
}
