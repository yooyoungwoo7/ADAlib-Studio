import { useMemo, useState } from "react";
import { Icon, ICONS } from "../../components/common/controls";
import { mpcControlsPlot, mpcCostPlot, mpcRuns, mpcStatesPlot, operatorLossPlot } from "../../plots/charts";
import { chartTokens, Plot } from "../../plots/Plot";
import { api } from "../../services/api";
import type { MPCResult, MPCRun, MPCTrainResult } from "../../types/api";

type Tab = "states" | "controls" | "cost" | "summary";

const fmt = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? "—" : v.toPrecision(d));
const num = (m: MPCRun["metadata"], k: string) => (typeof m[k] === "number" ? (m[k] as number) : null);

/** Per-step optimizer time: adalib's solver stats when the surrogate loop ran, else closed-loop time / step. */
const msPerStep = (run: MPCRun) => num(run.metadata, "opt_ms_per_step_mean") ?? num(run.metadata, "ms_per_step");
/** Cost (rollout) evaluations per step. */
const evalsPerStep = (run: MPCRun) => num(run.metadata, "opt_nfev_mean") ?? num(run.metadata, "rollouts_per_step");
/** Optimizer time per cost evaluation; only from adalib's solver stats (time and count measured together). */
const msPerEval = (run: MPCRun) => {
  const ms = num(run.metadata, "opt_ms_per_step_mean");
  const n = evalsPerStep(run);
  return ms != null && n ? ms / n : null;
};

export function MPCResults({ jobId, r, themeKey }: { jobId: string; r: MPCResult; themeKey: string }) {
  const [tab, setTab] = useState<Tab>("states");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => chartTokens(), [themeKey]);
  const states = useMemo(() => mpcStatesPlot(t, r), [t, r]);
  const controls = useMemo(() => mpcControlsPlot(t, r), [t, r]);
  const cost = useMemo(() => mpcCostPlot(t, r), [t, r]);
  const runs = mpcRuns(r);
  const multi = runs.length > 1;
  const base = `${r.system.name}_mpc_${jobId}`;
  const tracked = Object.keys(r.targets);
  const s = r.surrogate;
  const so = s?.options ?? r.options;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center border-b border-line shrink-0 overflow-x-auto" role="tablist" aria-label="MPC result views">
        {(
          [
            ["states", "Closed-loop states"],
            ["controls", "Control inputs"],
            ["cost", "Objective"],
            ["summary", multi ? "Controller comparison" : "Summary"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`h-9 px-3 text-[12.5px] border-b-2 -mb-px cursor-pointer whitespace-nowrap ${tab === id ? "border-accent text-ink font-medium" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 px-2 shrink-0">
          {r.files.map((f) => (
            <a key={f} className="inline-flex items-center gap-1 h-7 px-2 rounded text-[12px] text-ink-2 hover:bg-panel-3 hover:text-ink" href={api.fileUrl(jobId, f)} download>
              <Icon d={ICONS.download} size={12} /> {f.replace(".csv", "")}
            </a>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3" role="tabpanel">
        {tab === "states" && (
          <div className="flex flex-col h-full min-h-[380px] gap-2">
            <p className="text-[12px] text-ink-2">
              Plant response (simulated by adalib) under the controls {multi ? `each controller (${runs.map((x) => x.label).join(", ")}) chose on the same surrogate` : "the MPC chose"}
              {tracked.length ? "; dashed = target." : "."}
            </p>
            <div className="flex-1 min-h-[320px]">
              <Plot spec={states} filename={`${base}_states`} ariaLabel="Closed-loop state trajectories" themeKey={themeKey} />
            </div>
          </div>
        )}
        {tab === "controls" && (
          <div className="flex flex-col h-full min-h-[300px] gap-2">
            <p className="text-[12px] text-ink-2">Each input is held constant over its step; dotted = bounds.</p>
            <div className="flex-1 min-h-[260px]">
              <Plot spec={controls} filename={`${base}_controls`} ariaLabel="Optimised control inputs" themeKey={themeKey} />
            </div>
          </div>
        )}
        {tab === "cost" && (
          <div className="flex flex-col h-full min-h-[300px] gap-2">
            <p className="text-[12px] text-ink-2">Optimizer objective reported by adalib at each step (MPCResult.cost).</p>
            <div className="flex-1 min-h-[260px]">
              <Plot spec={cost} filename={`${base}_objective`} ariaLabel="Objective per MPC step" themeKey={themeKey} />
            </div>
          </div>
        )}
        {tab === "summary" && (
          <div className="flex flex-col gap-5 text-[12.5px]">
            <div className="overflow-x-auto">
              <h3 className="panel-title mb-1.5">{multi ? "Controllers on the same surrogate" : "Controller"}</h3>
              <table className="tabular-nums">
                <thead>
                  <tr className="text-left text-ink-2 [&_th]:font-medium [&_th]:pr-5 [&_th]:pb-1 [&_th]:whitespace-nowrap">
                    <th>Controller</th>
                    {r.mode === "tracking"
                      ? tracked.flatMap((n) => [<th key={`${n}-f`}>{n}: final |error|</th>, <th key={`${n}-m`}>{n}: mean |error|</th>])
                      : [<th key="eco">{runs[0].economic?.label ?? "economic objective"} (final)</th>]}
                    <th>optimizer ms / step</th>
                    <th>cost evals / step</th>
                    <th>ms / evaluation</th>
                    <th>closed loop [s]</th>
                  </tr>
                </thead>
                <tbody className="font-mono [&_td]:pr-5">
                  {runs.map((run) => (
                    <tr key={run.label}>
                      <td className="font-sans font-medium">{run.label}</td>
                      {r.mode === "tracking"
                        ? tracked.flatMap((n) => [<td key={`${n}-f`}>{fmt(run.tracking[n]?.final_abs_error)}</td>, <td key={`${n}-m`}>{fmt(run.tracking[n]?.mean_abs_error)}</td>])
                        : [<td key="eco">{fmt(run.economic?.final, 5)}</td>]}
                      <td>{fmt(msPerStep(run), 3)}</td>
                      <td>{fmt(evalsPerStep(run), 4)}</td>
                      <td>{fmt(msPerEval(run), 3)}</td>
                      <td>{fmt(num(run.metadata, "elapsed_s") ?? run.wall_time_sec, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1.5 text-[11.5px] text-muted leading-snug">
                ms / step and evals / step are adalib's solver statistics where its surrogate loop reports them (built-in
                systems); otherwise the closed-loop time divided by the steps. CEM/MPPI evals = rollouts evaluated per step.
                ms / evaluation = optimizer ms / step ÷ evals / step, the cost of one horizon rollout (AD: including its
                backward pass); batched CEM/MPPI make many cheap evaluations per step, SLSQP few expensive ones.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <h3 className="panel-title mb-1.5">Surrogate</h3>
                <table>
                  <tbody className="[&_th]:text-left [&_th]:font-normal [&_th]:text-ink-2 [&_th]:pr-3 [&_td]:font-mono">
                    {s ? (
                      <>
                        <tr><th>model</th><td>{s.label}</td></tr>
                        <tr><th>trained</th><td>{s.trained_at?.replace("T", " ").slice(0, 16) ?? "—"}{s.train_seconds != null ? ` · ${s.train_seconds.toFixed(1)} s` : ""}</td></tr>
                        <tr><th>reused</th><td>loaded from its checkpoint; this run trained nothing</td></tr>
                      </>
                    ) : (
                      <tr><th>model</th><td>trained inside this run (one-shot)</td></tr>
                    )}
                    <tr><th>size</th><td>{so.n_train} cases · {so.epochs} epochs · {so.hidden} × {so.n_layers}</td></tr>
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="panel-title mb-1.5">Run</h3>
                <table>
                  <tbody className="[&_th]:text-left [&_th]:font-normal [&_th]:text-ink-2 [&_th]:pr-3 [&_td]:font-mono">
                    <tr><th>adalib</th><td>{r.adalib_version} · run_mpc · {r.source === "custom" ? "generic tracking" : `built-in ${String(r.metadata.mpc_problem_name ?? "")}`}</td></tr>
                    <tr><th>mode</th><td>{r.mode}</td></tr>
                    <tr><th>steps</th><td>{r.cost.length}{r.options.horizon ? ` · horizon ${r.options.horizon}` : ""}</td></tr>
                    <tr><th>worker total</th><td>{r.wall_time_sec.toFixed(1)} s{s ? "" : " (incl. surrogate training)"}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            {r.warnings.length > 0 && (
              <div>
                <h3 className="panel-title mb-1">Warnings</h3>
                <ul className="list-disc pl-5 text-warn">
                  {r.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A finished surrogate-training job. */
export function MPCTrainView({ r, themeKey }: { r: MPCTrainResult; themeKey: string }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => chartTokens(), [themeKey]);
  const loss = useMemo(() => (r.history?.epoch?.length ? operatorLossPlot(t, r.history) : null), [t, r]);
  const m = r.manifest;
  const o = m.options;
  return (
    <div className="flex flex-col h-full min-h-0 p-3 gap-3 text-[12.5px]">
      <div>
        <h3 className="panel-title mb-1">Surrogate trained · {m.label}</h3>
        <p className="text-ink-2 leading-snug">
          {o.n_train} cases · {o.epochs} epochs · {o.hidden} × {o.n_layers} · {r.train_seconds.toFixed(1)} s
          {m.best_val_loss != null ? ` · best validation loss ${m.best_val_loss.toExponential(3)}` : ""}. Saved as model{" "}
          <span className="font-mono">{m.model_id}</span>. Choose controllers in the MPC panel and press <b>Run MPC</b>: the
          closed loop loads this checkpoint and does not retrain.
        </p>
      </div>
      {loss ? (
        <div className="flex-1 min-h-[280px]">
          <Plot spec={loss} filename={`mpc_surrogate_${m.model_id}_loss`} ariaLabel="Surrogate training loss" themeKey={themeKey} />
        </div>
      ) : (
        <p className="text-muted">adalib logged no per-epoch losses for this surrogate.</p>
      )}
      {r.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-warn">
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
