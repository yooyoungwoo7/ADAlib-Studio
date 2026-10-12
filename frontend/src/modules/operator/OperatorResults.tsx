import { useMemo, useState } from "react";
import { Button, Icon, ICONS, NumberField } from "../../components/common/controls";
import { operatorLossPlot, predictionsPlot } from "../../plots/charts";
import { chartTokens, Plot } from "../../plots/Plot";
import { api } from "../../services/api";
import type { OperatorManifest, OperatorPrediction, OperatorTrainResult } from "../../types/api";

export interface PredictionEntry {
  id: string;
  label: string;
  p: OperatorPrediction;
}

type Tab = "predict" | "compare" | "training";

export function OperatorResults({
  models,
  model,
  onModel,
  train,
  predictions,
  x0,
  inputs,
  onInputs,
  onPredict,
  predictBlock,
  onRemove,
  themeKey,
}: {
  models: OperatorManifest[];
  model: OperatorManifest;
  onModel: (id: string) => void;
  train: OperatorTrainResult | null;
  predictions: PredictionEntry[];
  x0: number[];
  inputs: number[];
  onInputs: (x0: number[], inputs: number[]) => void;
  onPredict: () => void;
  predictBlock: string | null;
  onRemove: (id: string) => void;
  themeKey: string;
}) {
  const [tab, setTab] = useState<Tab>("predict");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => chartTokens(), [themeKey]);
  const latest = predictions[predictions.length - 1];
  const latestSpec = useMemo(() => (latest ? predictionsPlot(t, model, [{ label: latest.label, p: latest.p }]) : null), [t, model, latest]);
  const compared = predictions.slice(-8);
  const compareSpec = useMemo(() => (compared.length ? predictionsPlot(t, model, compared) : null), [t, model, compared]);
  const lossSpec = useMemo(() => (train?.history ? operatorLossPlot(t, train.history) : null), [t, train]);
  const unit = model.input_kind === "control" ? "control" : "θ";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-line shrink-0 overflow-x-auto">
        <label htmlFor="op-model" className="text-[12px] text-ink-2 shrink-0">
          Model
        </label>
        <select id="op-model" className="field w-auto max-w-[320px]" value={model.model_id} onChange={(e) => onModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.model_id} value={m.model_id}>
              {m.label} · {m.trained_at.replace("T", " ").slice(0, 16)}
            </option>
          ))}
        </select>
        <div className="flex items-center ml-2" role="tablist" aria-label="Operator views">
          {(
            [
              ["predict", "Predict"],
              ["compare", `Compare (${predictions.length})`],
              ["training", "Training"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`h-10 px-3 text-[12.5px] border-b-2 cursor-pointer whitespace-nowrap ${tab === id ? "border-accent text-ink font-medium" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <a className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[12.5px] text-ink-2 hover:bg-panel-3 hover:text-ink shrink-0" href={api.fileUrl(model.model_id, "model.json")} download>
          <Icon d={ICONS.download} /> model.json
        </a>
      </div>

      <div className="flex-1 min-h-0 overflow-auto" role="tabpanel">
        {tab === "predict" && (
          <div className="flex flex-col xl:flex-row h-full min-h-0">
            <div className="xl:w-[290px] shrink-0 p-3 border-b xl:border-b-0 xl:border-r border-line overflow-y-auto">
              <InputGroup title="Initial state x₀" names={model.state_names} values={x0} domain={model.domain.x0} onChange={(v) => onInputs(v, inputs)} />
              {model.input_names.length > 0 && (
                <InputGroup
                  title={model.input_kind === "control" ? "Control inputs u (constant)" : "Parameters θ (constant)"}
                  names={model.input_names}
                  values={inputs}
                  domain={model.domain.inputs}
                  onChange={(v) => onInputs(x0, v)}
                />
              )}
              <div className="flex items-center gap-2 mt-3">
                <Button variant="primary" onClick={onPredict} disabled={!!predictBlock} title={predictBlock ?? "Predict with the trained operator"}>
                  <Icon d={ICONS.play} /> Predict
                </Button>
                <Button variant="ghost" onClick={() => onInputs([...model.nominal.x0], [...model.nominal.inputs])}>
                  Nominal
                </Button>
              </div>
              <p className="mt-2 text-[11.5px] text-muted leading-snug">
                Sliders span the training range. Values outside it are allowed but flagged: the operator then extrapolates.
                Each prediction is a short job (model reload, ~3 s including TensorFlow start-up).
              </p>
            </div>
            <div className="flex-1 min-w-0 flex flex-col p-3 gap-2 min-h-[420px]">
              {latest ? (
                <>
                  <PredictionStats e={latest} unit={unit} />
                  <div className="flex-1 min-h-[320px]">
                    {latestSpec && <Plot spec={latestSpec} filename={`operator_${model.model_id}_${latest.id}`} ariaLabel="Operator prediction per state" themeKey={themeKey} />}
                  </div>
                </>
              ) : (
                <p className="m-auto text-ink-2">No prediction yet for this model. Set x₀ and inputs, then press Predict.</p>
              )}
            </div>
          </div>
        )}

        {tab === "compare" && (
          <div className="flex flex-col h-full p-3 gap-3 min-h-[460px]">
            {compared.length ? (
              <>
                <p className="text-[12px] text-ink-2">
                  Up to the 8 most recent predictions of this model, one colour each; {t.paper ? "black solid = reference, dashed = operator" : "dashed = reference"}.
                </p>
                <div className="flex-1 min-h-[320px]">
                  {compareSpec && <Plot spec={compareSpec} filename={`operator_${model.model_id}_compare`} ariaLabel="Comparison of operator predictions" themeKey={themeKey} />}
                </div>
                <table className="text-[12px] font-mono tabular-nums">
                  <thead>
                    <tr className="text-left text-ink-2">
                      <th className="font-medium pr-3">Run</th>
                      <th className="font-medium pr-3">x₀</th>
                      <th className="font-medium pr-3">{unit}</th>
                      <th className="font-medium pr-3">max |Δ| / range</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {predictions.map((e, k) => (
                      <tr key={e.id} className="hover:bg-panel-2">
                        <td className="pr-3">
                          <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: k >= predictions.length - 8 ? `var(--series-${((k - Math.max(0, predictions.length - 8)) % 8) + 1})` : "transparent" }} />
                          {e.label}
                        </td>
                        <td className="pr-3">{e.p.x0.map((v) => v.toPrecision(4)).join(", ")}</td>
                        <td className="pr-3">{e.p.inputs.map((v) => v.toPrecision(4)).join(", ") || "—"}</td>
                        <td className="pr-3">{worst(e.p)}</td>
                        <td>
                          <Button variant="ghost" aria-label={`Remove ${e.label}`} onClick={() => onRemove(e.id)}>
                            <Icon d={ICONS.x} size={12} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="m-auto text-ink-2">Predictions you make with this model are collected here.</p>
            )}
          </div>
        )}

        {tab === "training" && (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 p-3 h-full min-h-[420px]">
            <div className="flex flex-col gap-2 min-h-[320px]">
              <p className="text-[12px] text-ink-2">
                {train?.history?.source === "log"
                  ? "Physics-residual loss as printed by adalib (generic path; logged every ~10 % of the epochs)."
                  : "Physics loss per epoch from adalib's learner.history."}
              </p>
              <div className="flex-1 min-h-[280px]">
                {lossSpec ? <Plot spec={lossSpec} filename={`operator_${model.model_id}_loss`} ariaLabel="Operator training loss" themeKey={themeKey} /> : <p className="text-muted">No training history available.</p>}
              </div>
            </div>
            <ModelSummary m={model} train={train} />
          </div>
        )}
      </div>
    </div>
  );
}

function worst(p: OperatorPrediction) {
  const v = Object.values(p.metrics).map((m) => m.max_abs_over_range).filter((x): x is number => x != null);
  return v.length ? `${(Math.max(...v) * 100).toFixed(2)} %` : "—";
}

function InputGroup({ title, names, values, domain, onChange }: { title: string; names: string[]; values: number[]; domain: [number, number][]; onChange: (v: number[]) => void }) {
  return (
    <fieldset className="mb-3">
      <legend className="panel-title mb-1.5">{title}</legend>
      <div className="flex flex-col gap-2.5">
        {names.map((n, i) => {
          const [lo, hi] = domain[i];
          const v = values[i];
          const out = v < lo || v > hi;
          const set = (x: number) => onChange(values.map((y, k) => (k === i ? x : y)));
          return (
            <div key={n}>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <label htmlFor={`in-${title}-${i}`} className="font-mono text-ink">
                  {n}
                </label>
                <span className={`text-[11px] font-mono ${out ? "text-warn" : "text-muted"}`}>
                  {out ? "outside " : ""}[{fmt(lo)}, {fmt(hi)}]
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2 items-center">
                <input
                  id={`in-${title}-${i}`}
                  type="range"
                  min={lo}
                  max={hi}
                  step={(hi - lo) / 200 || 1}
                  value={Math.min(Math.max(v, lo), hi)}
                  onChange={(e) => set(Number(e.target.value))}
                  aria-label={`${n} slider`}
                  className="w-full accent-[var(--accent)]"
                />
                <NumberField label={`${n} value`} value={v} onChange={set} />
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function fmt(v: number) {
  return Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(1) : String(+v.toPrecision(4));
}

function PredictionStats({ e, unit }: { e: PredictionEntry; unit: string }) {
  const m = Object.entries(e.p.metrics);
  return (
    <div className="flex flex-col gap-1.5 text-[12px]">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-ink-2">
        <span className="text-ink font-medium">{e.label}</span>
        <span>operator rollout {(e.p.predict_seconds * 1000).toFixed(0)} ms</span>
        <span>
          {unit}: <span className="font-mono">{e.p.inputs.map((v) => v.toPrecision(4)).join(", ") || "—"}</span>
        </span>
        {m.length > 0 && (
          <span>
            max |Δ| / range:{" "}
            <span className="font-mono">
              {m.map(([n, v]) => `${n} ${v.max_abs_over_range == null ? "—" : (v.max_abs_over_range * 100).toFixed(2) + " %"}`).join(" · ")}
            </span>
          </span>
        )}
      </div>
      {e.p.domain_warnings.map((w) => (
        <p key={w} role="alert" className="text-warn">
          ⚠ {w}
        </p>
      ))}
      {e.p.reference?.error && <p className="text-bad">Reference failed: {e.p.reference.error}</p>}
      {e.p.reference?.label && !e.p.reference.error && <p className="text-[11.5px] text-muted">Reference: {e.p.reference.label}</p>}
    </div>
  );
}

function ModelSummary({ m, train }: { m: OperatorManifest; train: OperatorTrainResult | null }) {
  const row = (k: string, v: unknown) => (
    <tr key={k}>
      <th className="text-left font-normal text-ink-2 pr-3 py-0.5 align-top whitespace-nowrap">{k}</th>
      <td className="font-mono py-0.5 break-all">{String(v)}</td>
    </tr>
  );
  return (
    <div className="text-[12.5px] overflow-y-auto">
      <h3 className="panel-title mb-2">Model</h3>
      <table>
        <tbody>
          {row("id", m.model_id)}
          {row("adalib path", m.path)}
          {row("system", m.system_name)}
          {row("segments", `${m.n_seg} × ${+(m.dt_seg * m.time_factor).toPrecision(4)} ${m.time_unit}`)}
          {row("network", `${m.options.hidden} × ${m.options.n_layers}`)}
          {row("samples", `${m.options.n_train} train / ${m.options.n_val} val`)}
          {row("epochs", m.options.epochs)}
          {row("training time", `${m.train_seconds.toFixed(1)} s`)}
          {m.best_val_loss != null && row("best val loss", m.best_val_loss.toExponential(3))}
          {row("adalib", m.adalib_version)}
        </tbody>
      </table>
      {train?.warnings?.length ? (
        <>
          <h3 className="panel-title mt-4 mb-1">Warnings</h3>
          <ul className="list-disc pl-5 text-warn">
            {train.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
