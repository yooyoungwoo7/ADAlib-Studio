import { Button, Field, NumberField, OptionalNumberField, Section } from "../../components/common/controls";
import { MPC_CONTROLLERS, MPC_DEFAULTS, type MPCProject } from "../../project";
import type { MPCBuiltin, MPCControllerId, MPCOptions, MPCSurrogate, OperatorPreset } from "../../types/api";

/** Custom systems: which states to track, references and weights. */
export function TrackingSection({ p, set }: { p: MPCProject; set: (patch: Partial<MPCProject>) => void }) {
  const states = p.system.states.map((s) => s.name);
  const controls = (p.system.controls ?? []).map((c) => c.name);
  return (
    <Section title="Tracking objective">
      <p className="text-[12px] text-ink-2 mb-2 leading-snug">
        adalib's generic MPC minimises Σ w<sub>Q</sub>(y − y<sub>ref</sub>)² + w<sub>R</sub> u² over the horizon (terminal
        weight = w<sub>Q</sub>). The objective form is fixed in adalib 0.1.0; only references and weights are set here.
      </p>
      <div className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-1.5 gap-y-1.5 items-center text-[12px]">
        <span />
        <span className="text-muted">State</span>
        <span className="text-muted">Reference</span>
        <span className="text-muted">Weight w_Q</span>
        {states.map((n) => {
          const on = n in p.targets;
          return (
            <div key={n} className="contents">
              <input
                type="checkbox"
                aria-label={`Track ${n}`}
                checked={on}
                onChange={(e) => {
                  const t = { ...p.targets };
                  if (e.target.checked) t[n] = p.system.states.find((s) => s.name === n)?.initial ?? 0;
                  else delete t[n];
                  set({ targets: t });
                }}
              />
              <span className="font-mono">{n}</span>
              {on ? (
                <>
                  <NumberField label={`Reference for ${n}`} value={p.targets[n]} onChange={(v) => set({ targets: { ...p.targets, [n]: v } })} />
                  <NumberField label={`Tracking weight for ${n}`} min={0} value={p.trackingWeights[n] ?? 1} onChange={(v) => set({ trackingWeights: { ...p.trackingWeights, [n]: v } })} />
                </>
              ) : (
                <span className="col-span-2 text-muted">not tracked</span>
              )}
            </div>
          );
        })}
      </div>
      {controls.length > 0 && (
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-1.5 items-center text-[12px]">
          <span className="text-muted">Control</span>
          <span className="text-muted">Effort weight w_R</span>
          {controls.map((c) => (
            <div key={c} className="contents">
              <span className="font-mono">{c}</span>
              <NumberField label={`Control weight for ${c}`} min={0} value={p.controlWeights[c] ?? 0.01} onChange={(v) => set({ controlWeights: { ...p.controlWeights, [c]: v } })} />
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-muted leading-snug">
        Control bounds come from the control inputs' lower/upper values; state ranges define the box the surrogate is
        trained on.
      </p>
    </Section>
  );
}

export function BuiltinMPCPanel({ b, p, set }: { b: MPCBuiltin | undefined; p: MPCProject; set: (patch: Partial<MPCProject>) => void }) {
  if (!b) return <p className="p-4 text-muted">Loading built-in systems…</p>;
  const x0 = p.builtinX0[b.id] ?? b.x0;
  const targets = p.builtinTargets[b.id] ?? b.targets;
  const bounds = p.builtinBounds[b.id] ?? b.control_bounds;
  return (
    <div className="flex flex-col">
      <Section title={b.title}>
        <p className="text-[12.5px] text-ink-2 leading-relaxed">{b.description}</p>
        <p className="mt-2 text-[11.5px] text-muted">
          Mode: <span className="font-medium">{b.mode}</span> · plant, time grid and surrogate problem come from adalib ({b.source}).
        </p>
      </Section>
      <Section title="Initial plant state x₀">
        <div className="grid grid-cols-2 gap-2">
          {b.states.map((n, i) => (
            <Field key={n} label={<span className="font-mono">{n}</span>} htmlFor={`bx0-${n}`}>
              <NumberField id={`bx0-${n}`} label={`Initial ${n}`} value={x0[i]} onChange={(v) => set({ builtinX0: { ...p.builtinX0, [b.id]: x0.map((y, k) => (k === i ? v : y)) } })} />
            </Field>
          ))}
        </div>
      </Section>
      {b.mode === "tracking" && (
        <Section title="Tracking targets">
          <div className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)] gap-x-1.5 gap-y-1.5 items-center text-[12px]">
            {b.trackable.map((n) => {
              const on = n in targets;
              return (
                <div key={n} className="contents">
                  <input
                    type="checkbox"
                    aria-label={`Track ${n}`}
                    checked={on}
                    onChange={(e) => {
                      const t = { ...targets };
                      if (e.target.checked) t[n] = b.targets[n] ?? 0;
                      else delete t[n];
                      if (Object.keys(t).length) set({ builtinTargets: { ...p.builtinTargets, [b.id]: t } });
                    }}
                  />
                  <span className="font-mono">{n}</span>
                  {on ? (
                    <NumberField label={`Target for ${n}`} value={targets[n]} onChange={(v) => set({ builtinTargets: { ...p.builtinTargets, [b.id]: { ...targets, [n]: v } } })} />
                  ) : (
                    <span className="text-muted">adalib default</span>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
      {b.mode === "economic" && (
        <Section title="Objective">
          <p className="text-[12px] text-ink-2">Maximise the final product amount Ps × Vs (fixed by adalib; no target to set).</p>
        </Section>
      )}
      <Section title="Control bounds">
        <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-1.5 items-center text-[12px]">
          <span className="text-muted">Control</span>
          <span className="text-muted">Lower</span>
          <span className="text-muted">Upper</span>
          {b.controls.map((c) => (
            <div key={c} className="contents">
              <span className="font-mono">{c}</span>
              <NumberField label={`Lower bound of ${c}`} value={bounds[c][0]} onChange={(v) => set({ builtinBounds: { ...p.builtinBounds, [b.id]: { ...bounds, [c]: [v, bounds[c][1]] } } })} />
              <NumberField label={`Upper bound of ${c}`} value={bounds[c][1]} onChange={(v) => set({ builtinBounds: { ...p.builtinBounds, [b.id]: { ...bounds, [c]: [bounds[c][0], v] } } })} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function trainedLabel(m: MPCSurrogate) {
  const o = m.options;
  const size = o.n_train != null ? `${o.n_train} cases · ${o.epochs} ep · ${o.hidden}×${o.n_layers}` : "";
  const when = m.trained_at ? m.trained_at.slice(5, 16).replace("T", " ") : "";
  return [m.label, size, when].filter(Boolean).join(" · ");
}

export function MPCConfig({
  p,
  set,
  builtins,
  presets,
  surrogates,
  hidden,
  surrogate,
  onTrain,
  trainBlock,
}: {
  p: MPCProject;
  set: (patch: Partial<MPCProject>) => void;
  builtins: MPCBuiltin[];
  presets: OperatorPreset[];
  /** trained surrogates that match the current system */
  surrogates: MPCSurrogate[];
  /** trained surrogates of other systems / settings */
  hidden: number;
  surrogate: MPCSurrogate | null;
  onTrain: () => void;
  trainBlock: string | null;
}) {
  const o = p.options;
  const setOpt = (patch: Partial<MPCOptions>, keepPreset = false) => set({ options: { ...o, ...patch }, ...(keepPreset ? {} : { presetId: null }) });
  const int = (k: keyof MPCOptions, label: string, min = 1, hint?: string) => (
    <Field label={label} hint={hint} htmlFor={`mpc-${k}`}>
      <NumberField id={`mpc-${k}`} label={label} integer min={min} value={o[k] as number} onChange={(v) => setOpt({ [k]: v })} />
    </Field>
  );
  const toggle = (id: MPCControllerId, on: boolean) =>
    set({ controllers: MPC_CONTROLLERS.map((c) => c.id).filter((c) => (c === id ? on : p.controllers.includes(c))) });
  return (
    <div className="min-w-0">
      <Section title="Model predictive control">
        <p className="text-[12px] text-ink-2 mb-3 leading-snug">
          Train the surrogate operator once, then run the receding-horizon loop on it as often as you like. Every
          controller below reuses the same trained surrogate (<code className="font-mono text-[11.5px]">run_mpc(reuse_existing_operator=True)</code>).
        </p>
        <div role="radiogroup" aria-label="System source" className="grid grid-cols-2 gap-1 p-0.5 bg-panel-3 rounded">
          {(["custom", "builtin"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={p.source === s}
              onClick={() => set({ source: s, controllers: s === "custom" ? p.controllers.filter((c) => c === "fd" || c === "autodiff") : p.controllers })}
              className={`h-7 rounded text-[12.5px] cursor-pointer ${p.source === s ? "bg-panel text-ink font-medium shadow-sm" : "text-ink-2 hover:text-ink"}`}
            >
              {s === "custom" ? "Custom (tracking)" : "Built-in"}
            </button>
          ))}
        </div>
        {p.source === "builtin" && (
          <div className="mt-3">
            <Field label="System" htmlFor="mpc-builtin">
              <select id="mpc-builtin" className="field" value={p.builtin} onChange={(e) => set({ builtin: e.target.value as MPCProject["builtin"] })}>
                {builtins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Section>

      <Section title="1 · Surrogate (trained once)">
        {surrogates.length ? (
          <Field label="Trained surrogate" htmlFor="mpc-surrogate" hint="The closed loop loads this checkpoint; nothing is retrained">
            <select id="mpc-surrogate" className="field" value={surrogate?.model_id ?? ""} onChange={(e) => set({ surrogateId: e.target.value })}>
              {surrogates.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {trainedLabel(m)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="text-[12px] text-ink-2 leading-snug">
            No trained surrogate for this {p.source === "custom" ? "system yet. It must match the equations, parameter values, state/control ranges and dt" : "built-in system yet"}.
          </p>
        )}
        {hidden > 0 && <p className="mt-1.5 text-[11.5px] text-muted">{hidden} surrogate{hidden > 1 ? "s" : ""} of other systems or settings hidden.</p>}
        {surrogate?.origin === "mpc_run" && <p className="mt-1.5 text-[11.5px] text-muted">Trained by an earlier one-shot MPC run; reused as is.</p>}

        <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Presets">
          {presets.map((pr) => (
            <Button key={pr.id} variant={p.presetId === pr.id ? "primary" : "default"} title={pr.note} aria-pressed={p.presetId === pr.id} onClick={() => set({ options: { ...o, ...(pr.options as Partial<MPCOptions>) }, presetId: pr.id })}>
              {pr.title}
            </Button>
          ))}
        </div>
        {p.presetId && <p className="mt-2 text-[11.5px] text-muted">{presets.find((x) => x.id === p.presetId)?.note}</p>}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {int("n_train", "Train samples", 2)}
          {int("n_val", "Validation samples")}
          {int("epochs", "Epochs")}
          {int("batch_size", "Batch size")}
          {int("hidden", "Hidden width", 4)}
          {int("n_layers", "Layers")}
        </div>
        <details className="mt-3">
          <summary className="text-[12px] text-ink-2 cursor-pointer hover:text-ink">Training details</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Learning rate" htmlFor="mpc-lr">
              <NumberField id="mpc-lr" label="Learning rate" value={o.lr} onChange={(v) => setOpt({ lr: v })} />
            </Field>
            {int("seed", "Seed", 0)}
            {p.source === "custom" ? (
              <>
                {int("lpa_n_panels", "LPA panels")}
                {int("lpa_max_order", "LPA max order")}
                {int("lpa_nt_seg", "Points / segment", 4)}
              </>
            ) : (
              <Field label="Surrogate basis" htmlFor="mpc-basis">
                <select id="mpc-basis" className="field" value={o.basis} onChange={(e) => setOpt({ basis: e.target.value as MPCOptions["basis"] })}>
                  <option value="lpa">LPA</option>
                  <option value="adaf">ADA-F</option>
                </select>
              </Field>
            )}
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" onClick={() => set({ options: { ...o, ...pickTraining(MPC_DEFAULTS) }, presetId: "adalib" })}>
              Reset to adalib defaults
            </Button>
          </div>
        </details>
        <div className="mt-3 flex items-center gap-2">
          <Button variant={surrogates.length ? "default" : "primary"} disabled={!!trainBlock} title={trainBlock ?? "Train a new surrogate with the settings above"} onClick={onTrain}>
            {surrogates.length ? "Train another surrogate" : "Train surrogate"}
          </Button>
          {trainBlock && <span className="text-[11.5px] text-muted">{trainBlock}</span>}
        </div>
      </Section>

      <Section title="2 · Closed loop">
        <div className="grid grid-cols-2 gap-2">
          {int("n_steps", "MPC steps")}
          <Field label="Horizon (steps)" htmlFor="mpc-horizon" hint="Empty = adalib default">
            <OptionalNumberField label="Horizon" placeholder="default" value={o.horizon} onChange={(v) => setOpt({ horizon: v == null ? null : Math.max(1, Math.round(v)) }, true)} />
          </Field>
          {p.source === "custom" && (
            <Field label="Plant solver" htmlFor="mpc-plant">
              <select id="mpc-plant" className="field" value={o.plant_solver} onChange={(e) => setOpt({ plant_solver: e.target.value }, true)}>
                {["RK45", "RK23", "DOP853", "Radau", "BDF", "LSODA"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <fieldset className="mt-3">
          <legend className="text-[12px] text-ink-2 mb-1.5">Controllers (all on the same surrogate)</legend>
          <div className="flex flex-col gap-1">
            {MPC_CONTROLLERS.map((c) => {
              const off = c.builtinOnly && p.source === "custom";
              return (
                <label key={c.id} className={`flex items-start gap-2 text-[12.5px] ${off ? "opacity-50" : "cursor-pointer"}`} title={off ? "Built-in systems only in adalib 0.1.0" : c.title}>
                  <input type="checkbox" className="mt-0.5" disabled={off} checked={!off && p.controllers.includes(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
                  <span>
                    <span className="font-medium">{c.label}</span> <span className="text-muted">— {c.title}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted leading-snug">
            Several selected = one job that runs them one after another and overlays the results. Conventional NMPC (ODE
            integrator in the loop) is not part of adalib 0.1.0.
          </p>
        </fieldset>
      </Section>
    </div>
  );
}

function pickTraining(o: MPCOptions): Partial<MPCOptions> {
  const { n_train, n_val, epochs, batch_size, lr, hidden, n_layers, seed, basis, use_lr_schedule, lpa_n_panels, lpa_max_order, lpa_nt_seg } = o;
  return { n_train, n_val, epochs, batch_size, lr, hidden, n_layers, seed, basis, use_lr_schedule, lpa_n_panels, lpa_max_order, lpa_nt_seg };
}
