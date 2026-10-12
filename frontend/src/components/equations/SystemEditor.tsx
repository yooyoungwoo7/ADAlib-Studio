import type { ReactNode } from "react";
import type { Capabilities, ControlSpec, SystemSpec, TimeSpan, ValidateResponse } from "../../types/api";
import { Button, Field, Icon, ICONS, NumberField, Section, Tex } from "../common/controls";

function latexName(name: string) {
  const greek = /^(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|kappa|lambda|mu|nu|xi|rho|sigma|tau|phi|chi|psi|omega)$/;
  const [base, ...sub] = name.split("_");
  const head = greek.test(base) ? `\\${base}` : base.length === 1 ? base : `\\mathrm{${base}}`;
  return sub.length ? `${head}_{${sub.join("_")}}` : head;
}

function nextName(prefix: string, taken: string[]) {
  for (let i = 1; ; i++) if (!taken.includes(`${prefix}${i}`)) return `${prefix}${i}`;
}

export function SystemEditor({
  system,
  time,
  onSystem,
  onTime,
  validation,
  validating,
  caps,
  disabled,
  variant = "forward",
  timeSection,
  extra,
}: {
  system: SystemSpec;
  time?: TimeSpan;
  onSystem: (s: SystemSpec) => void;
  onTime?: (t: TimeSpan) => void;
  validation: ValidateResponse | null;
  validating: boolean;
  caps: Capabilities | null;
  disabled: boolean;
  /** "operator": states get a training range, control inputs are editable */
  variant?: "forward" | "operator";
  /** replaces the default time-domain section */
  timeSection?: ReactNode;
  /** module-specific sections appended at the end */
  extra?: ReactNode;
}) {
  const withRanges = variant === "operator";
  const controls = system.controls ?? [];
  const names = [...system.states.map((s) => s.name), ...system.parameters.map((p) => p.name), ...controls.map((c) => c.name)];
  const setControl = (i: number, patch: Partial<ControlSpec>) =>
    onSystem({ ...system, controls: controls.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const errors = validation?.ok === false ? validation.errors : [];
  const generalErrors = errors.filter((e) => e.index === null);

  const setState = (i: number, patch: Partial<SystemSpec["states"][number]>) =>
    onSystem({ ...system, states: system.states.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const setParam = (i: number, patch: Partial<SystemSpec["parameters"][number]>) =>
    onSystem({ ...system, parameters: system.parameters.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const setEq = (i: number, eq: string) =>
    onSystem({ ...system, equations: system.equations.map((e, k) => (k === i ? eq : e)) });

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <Section title="System">
        <Field label="System name" htmlFor="sys-name">
          <input
            id="sys-name"
            className="field"
            value={system.name}
            onChange={(e) => onSystem({ ...system, name: e.target.value })}
          />
        </Field>
      </Section>

      <Section
        title="State variables & initial conditions"
        actions={
          <Button
            variant="ghost"
            aria-label="Add state variable"
            title="Add state variable"
            onClick={() =>
              onSystem({
                ...system,
                states: [...system.states, withRanges ? { name: nextName("x", names), initial: 0, lower: -1, upper: 1 } : { name: nextName("x", names), initial: 0 }],
                equations: [...system.equations, "0"],
              })
            }
          >
            <Icon d={ICONS.plus} /> State
          </Button>
        }
      >
        <div
          className={`grid gap-x-2 gap-y-1.5 items-center ${
            withRanges ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_28px]" : "grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_28px]"
          }`}
        >
          <span className="text-[11.5px] text-muted">Name</span>
          <span className="text-[11.5px] text-muted">
            {withRanges ? "Preview x₀" : <>Initial value x(t<sub>0</sub>)</>}
          </span>
          {withRanges && <span className="text-[11.5px] text-muted" title="Training range: initial states are sampled uniformly in [lower, upper]">Train lower</span>}
          {withRanges && <span className="text-[11.5px] text-muted">Train upper</span>}
          <span />
          {system.states.map((s, i) => (
            <Row key={i}>
              <input
                className="field mono"
                aria-label={`State ${i + 1} name`}
                value={s.name}
                onChange={(e) => setState(i, { name: e.target.value })}
              />
              <NumberField label={`Initial value of ${s.name || `state ${i + 1}`}`} value={s.initial} onChange={(v) => setState(i, { initial: v })} />
              {withRanges && (
                <NumberField label={`Training lower bound of ${s.name}`} value={s.lower ?? NaN} onChange={(v) => setState(i, { lower: v })} />
              )}
              {withRanges && (
                <NumberField label={`Training upper bound of ${s.name}`} value={s.upper ?? NaN} onChange={(v) => setState(i, { upper: v })} />
              )}
              <RemoveButton
                label={`Remove state ${s.name}`}
                disabled={system.states.length <= 1}
                onClick={() =>
                  onSystem({
                    ...system,
                    states: system.states.filter((_, k) => k !== i),
                    equations: system.equations.filter((_, k) => k !== i),
                  })
                }
              />
            </Row>
          ))}
        </div>
      </Section>

      <Section
        title="Parameters"
        actions={
          <Button
            variant="ghost"
            aria-label="Add parameter"
            title="Add parameter"
            onClick={() => onSystem({ ...system, parameters: [...system.parameters, { name: nextName("p", names), value: 1 }] })}
          >
            <Icon d={ICONS.plus} /> Parameter
          </Button>
        }
      >
        {system.parameters.length === 0 ? (
          <p className="text-muted text-[12px]">No parameters. Numeric constants can be written directly in the equations.</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_28px] gap-x-2 gap-y-1.5 items-center">
            <span className="text-[11.5px] text-muted">Name</span>
            <span className="text-[11.5px] text-muted">Value</span>
            <span />
            {system.parameters.map((p, i) => (
              <Row key={i}>
                <input
                  className="field mono"
                  aria-label={`Parameter ${i + 1} name`}
                  value={p.name}
                  onChange={(e) => setParam(i, { name: e.target.value })}
                />
                <NumberField label={`Value of ${p.name || `parameter ${i + 1}`}`} value={p.value} onChange={(v) => setParam(i, { value: v })} />
                <RemoveButton
                  label={`Remove parameter ${p.name}`}
                  onClick={() => onSystem({ ...system, parameters: system.parameters.filter((_, k) => k !== i) })}
                />
              </Row>
            ))}
          </div>
        )}
        {validation?.ok && validation.unused_parameters.length > 0 && (
          <p className="mt-2 text-[12px] text-warn">
            Not used in any equation: {validation.unused_parameters.join(", ")}
          </p>
        )}
      </Section>

      {withRanges && (
        <Section
          title="Control inputs"
          actions={
            <Button
              variant="ghost"
              aria-label="Add control input"
              title="Add control input"
              onClick={() => onSystem({ ...system, controls: [...controls, { name: nextName("u", names), value: 0, lower: -1, upper: 1 }] })}
            >
              <Icon d={ICONS.plus} /> Control
            </Button>
          }
        >
          {controls.length === 0 ? (
            <p className="text-muted text-[12px]">
              No control inputs: the operator maps an initial state to its trajectory. Add inputs (held constant over
              each segment) to learn their effect too.
            </p>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_28px] gap-x-2 gap-y-1.5 items-center">
              <span className="text-[11.5px] text-muted">Name</span>
              <span className="text-[11.5px] text-muted">Preview u</span>
              <span className="text-[11.5px] text-muted">Train lower</span>
              <span className="text-[11.5px] text-muted">Train upper</span>
              <span />
              {controls.map((c, i) => (
                <Row key={i}>
                  <input className="field mono" aria-label={`Control ${i + 1} name`} value={c.name} onChange={(e) => setControl(i, { name: e.target.value })} />
                  <NumberField label={`Preview value of ${c.name}`} value={c.value} onChange={(v) => setControl(i, { value: v })} />
                  <NumberField label={`Training lower bound of ${c.name}`} value={c.lower} onChange={(v) => setControl(i, { lower: v })} />
                  <NumberField label={`Training upper bound of ${c.name}`} value={c.upper} onChange={(v) => setControl(i, { upper: v })} />
                  <RemoveButton label={`Remove control ${c.name}`} onClick={() => onSystem({ ...system, controls: controls.filter((_, k) => k !== i) })} />
                </Row>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11.5px] text-muted leading-snug">
            adalib's generic operator calls the equations without parameters, so the parameter values above are fixed
            into the model at training time.
          </p>
        </Section>
      )}

      <Section
        title="Governing equations"
        actions={<span className="text-[11.5px] text-muted">{validating ? "checking…" : validation?.ok ? "valid" : ""}</span>}
      >
        <div className="flex flex-col gap-3">
          {system.states.map((s, i) => {
            const err = errors.find((e) => e.index === i);
            const latex = validation?.ok ? validation.latex[i] : null;
            return (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <label htmlFor={`eq-${i}`} className="shrink-0 w-[70px] text-right text-ink-2">
                    <Tex tex={`\\frac{d${latexName(s.name || "?")}}{dt} =`} />
                  </label>
                  <input
                    id={`eq-${i}`}
                    className="field mono"
                    spellCheck={false}
                    autoComplete="off"
                    value={system.equations[i] ?? ""}
                    aria-invalid={!!err}
                    aria-describedby={err ? `eq-${i}-err` : undefined}
                    onChange={(e) => setEq(i, e.target.value)}
                  />
                </div>
                <div className="pl-[78px] min-h-[22px] text-[12.5px]">
                  {err ? (
                    <span id={`eq-${i}-err`} role="alert" className="text-bad">
                      {err.message}
                    </span>
                  ) : latex ? (
                    <Tex className="text-ink-2" tex={`\\frac{d${latexName(s.name)}}{dt} = ${latex}`} />
                  ) : null}
                </div>
              </div>
            );
          })}
          {generalErrors.map((e, k) => (
            <p key={k} role="alert" className="text-bad text-[12.5px]">
              {e.message}
            </p>
          ))}
          <details className="text-[12px] text-ink-2">
            <summary className="cursor-pointer text-muted hover:text-ink">Equation syntax</summary>
            <div className="mt-1.5 flex flex-col gap-1 leading-relaxed">
              <span>
                Operators: <code className="font-mono">+ - * / ^</code> and parentheses. Constants:{" "}
                <code className="font-mono">{(caps?.parser.constants ?? ["e", "pi"]).join(", ")}</code>.
              </span>
              <span>
                Functions:{" "}
                <code className="font-mono">{(caps?.parser.functions ?? []).join(", ")}</code>
              </span>
              <span>
                Right-hand sides may use state variables, parameters{withRanges ? " and control inputs" : ""} only. {caps?.parser.time_dependence_note}
              </span>
            </div>
          </details>
        </div>
      </Section>

      {timeSection ?? (time && onTime && <Section title="Time domain">
        <div className="grid grid-cols-2 gap-2">
          <Field label={<>t<sub>start</sub></>} htmlFor="t0">
            <NumberField id="t0" label="Start time" value={time.t0} onChange={(v) => onTime({ ...time, t0: v })} />
          </Field>
          <Field label={<>t<sub>end</sub></>} htmlFor="t1">
            <NumberField id="t1" label="End time" value={time.t1} onChange={(v) => onTime({ ...time, t1: v })} />
          </Field>
        </div>
      </Section>)}
      {extra}
    </fieldset>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-7 inline-flex items-center justify-center rounded text-muted hover:bg-panel-3 hover:text-bad disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
    >
      <Icon d={ICONS.x} size={12} />
    </button>
  );
}
