import { useMemo, useState } from "react";
import { errorPlot, lossPlot, phasePlot, trajectoryPlot } from "../../plots/charts";
import { chartTokens, Plot } from "../../plots/Plot";
import { api } from "../../services/api";
import { download, slug } from "../../project";
import type { ForwardResult, ForwardRunRequest } from "../../types/api";
import { Button, Icon, ICONS } from "../../components/common/controls";

type Tab = "trajectories" | "phase" | "history" | "error" | "data" | "summary";

export function ForwardResults({
  jobId,
  result,
  request,
  themeKey,
  onRestore,
}: {
  jobId: string;
  result: ForwardResult;
  request: ForwardRunRequest | null;
  themeKey: string;
  onRestore?: () => void;
}) {
  const names = result.system.state_names;
  const hasRef = !!result.reference?.y;
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "trajectories", label: "Trajectories", show: true },
    { id: "phase", label: "Phase portrait", show: names.length >= 2 },
    { id: "history", label: "Training history", show: true },
    { id: "error", label: "Error vs reference", show: hasRef },
    { id: "data", label: "Data table", show: true },
    { id: "summary", label: "Run summary", show: true },
  ];
  const [tab, setTab] = useState<Tab>("trajectories");
  const [visible, setVisible] = useState<string[]>(names);
  const [phase, setPhase] = useState<[string, string]>([names[0], names[1] ?? names[0]]);
  const base = `${slug(result.system.name)}_${jobId}`;

  // re-read theme tokens whenever the theme changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => chartTokens(), [themeKey]);

  const trajSpec = useMemo(
    () =>
      trajectoryPlot(
        t,
        result.t,
        names.filter((n) => visible.includes(n)).map((n) => ({ name: n, y: result.y[n], ref: result.reference?.y?.[n] ?? null })),
        names,
        { refLabel: "reference, BDF" },
      ),
    [t, result, visible, names],
  );
  const phaseSpec = useMemo(() => (names.length >= 2 ? phasePlot(t, result, phase[0], phase[1]) : null), [t, result, phase, names]);
  const lossSpec = useMemo(() => lossPlot(t, result.history), [t, result]);
  const errSpec = useMemo(() => errorPlot(t, result), [t, result]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center border-b border-line shrink-0 overflow-x-auto" role="tablist" aria-label="Result views">
        {tabs
          .filter((x) => x.show)
          .map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={tab === x.id}
              className={`h-9 px-3 text-[12.5px] border-b-2 -mb-px cursor-pointer whitespace-nowrap ${
                tab === x.id ? "border-accent text-ink font-medium" : "border-transparent text-ink-2 hover:text-ink"
              }`}
              onClick={() => setTab(x.id)}
            >
              {x.label}
            </button>
          ))}
        <div className="ml-auto flex items-center gap-1 px-2 shrink-0">
          <a
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[12.5px] text-ink-2 hover:bg-panel-3 hover:text-ink"
            href={api.fileUrl(jobId, "trajectory.csv")}
            download
          >
            <Icon d={ICONS.download} /> CSV
          </a>
          <Button
            variant="ghost"
            disabled={!request}
            onClick={() => request && download(`${base}_config.json`, JSON.stringify(request, null, 2))}
          >
            <Icon d={ICONS.download} /> Config JSON
          </Button>
          {onRestore && (
            <Button variant="ghost" onClick={onRestore} title="Load this run's system and options into the editor">
              <Icon d={ICONS.restore} /> Restore inputs
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3" role="tabpanel">
        {tab === "trajectories" && (
          <div className="flex flex-col h-full min-h-[300px] gap-2">
            {names.length > 1 && (
              <div className="flex flex-wrap items-center gap-3 text-[12px]" aria-label="Visible states">
                {names.map((n, i) => (
                  <label key={n} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visible.includes(n)}
                      onChange={(e) => setVisible(e.target.checked ? names.filter((x) => x === n || visible.includes(x)) : visible.filter((x) => x !== n))}
                    />
                    <span className="inline-block w-3 h-0.5" style={{ background: `var(--series-${(i % 8) + 1})` }} aria-hidden />
                    {n}
                  </label>
                ))}
              </div>
            )}
            <div className="flex-1 min-h-0">
              <Plot spec={trajSpec} filename={`${base}_trajectories`} ariaLabel="State trajectories versus time" themeKey={themeKey} />
            </div>
          </div>
        )}

        {tab === "phase" && phaseSpec && (
          <div className="flex flex-col h-full min-h-[300px] gap-2">
            <div className="flex items-center gap-2 text-[12px]">
              <label htmlFor="phase-x">x-axis</label>
              <select id="phase-x" className="field w-auto" value={phase[0]} onChange={(e) => setPhase([e.target.value, phase[1]])}>
                {names.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <label htmlFor="phase-y">y-axis</label>
              <select id="phase-y" className="field w-auto" value={phase[1]} onChange={(e) => setPhase([phase[0], e.target.value])}>
                {names.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-h-0">
              <Plot spec={phaseSpec} filename={`${base}_phase_${phase[0]}_${phase[1]}`} ariaLabel={`Phase portrait ${phase[1]} versus ${phase[0]}`} themeKey={themeKey} />
            </div>
          </div>
        )}

        {tab === "history" && (
          <div className="flex flex-col h-full min-h-[300px] gap-2">
            <p className="text-[12px] text-ink-2">
              Residual loss after each optimizer stage, as printed by adalib (
              {result.history[0]?.unit === "epoch" ? "per Adam epoch, then one final L-BFGS" : "per sequential ADA-F segment"}
              ). adalib 0.1.0 exposes no in-memory training history; these are its logged values.
            </p>
            {result.history.length ? (
              <div className="flex-1 min-h-0">
                <Plot spec={lossSpec} filename={`${base}_training_loss`} ariaLabel="Training loss per stage" themeKey={themeKey} />
              </div>
            ) : (
              <p className="text-muted">No stage lines were found in the log.</p>
            )}
          </div>
        )}

        {tab === "error" && errSpec && (
          <div className="flex flex-col h-full min-h-[300px] gap-2">
            <p className="text-[12px] text-ink-2">
              Pointwise |ADA − reference| on the returned grid (derived quantity). Reference: {result.reference?.label}.
            </p>
            <div className="flex-1 min-h-0">
              <Plot spec={errSpec} filename={`${base}_error`} ariaLabel="Absolute difference from the reference over time" themeKey={themeKey} />
            </div>
          </div>
        )}

        {tab === "data" && <DataTable result={result} />}
        {tab === "summary" && <Summary result={result} />}
      </div>
    </div>
  );
}

function DataTable({ result }: { result: ForwardResult }) {
  const names = result.system.state_names;
  const ref = result.reference?.y;
  const n = result.t.length;
  const MAX = 400;
  const step = Math.max(1, Math.ceil(n / MAX));
  const rows: number[] = [];
  for (let i = 0; i < n; i += step) rows.push(i);
  if (rows[rows.length - 1] !== n - 1) rows.push(n - 1);
  const f = (v: number | null | undefined) => (v == null ? "—" : v.toPrecision(7));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-ink-2">
        {step > 1 ? `Every ${step}th of ${result.n_points} points shown. ` : `All ${result.n_points} points. `}
        Download the CSV for the full-resolution data.
      </p>
      <table className="text-[12px] font-mono tabular-nums border-collapse">
        <thead className="sticky top-0 bg-panel">
          <tr className="text-left text-ink-2">
            <th className="px-2 py-1 border-b border-line font-medium">t</th>
            {names.map((s) => (
              <th key={s} className="px-2 py-1 border-b border-line font-medium">{s}</th>
            ))}
            {ref && names.map((s) => (
              <th key={`r-${s}`} className="px-2 py-1 border-b border-line font-medium">{s} (ref)</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i} className="hover:bg-panel-2">
              <td className="px-2 py-0.5">{f(result.t[i])}</td>
              {names.map((s) => (
                <td key={s} className="px-2 py-0.5">{f(result.y[s][i])}</td>
              ))}
              {ref && names.map((s) => (
                <td key={`r-${s}`} className="px-2 py-0.5 text-ink-2">{f(ref[s][i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ result }: { result: ForwardResult }) {
  const meta = result.solver_meta;
  const metrics = Object.entries(result.metrics);
  const kv = (k: string, v: unknown) => (
    <tr key={k}>
      <th className="text-left font-normal text-ink-2 pr-4 py-0.5 align-top whitespace-nowrap">{k}</th>
      <td className="font-mono py-0.5 break-all">{typeof v === "number" ? (Number.isInteger(v) ? v : v.toPrecision(6)) : String(v)}</td>
    </tr>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2 text-[12.5px]">
      <div>
        <h3 className="panel-title mb-2">Accuracy vs reference</h3>
        {metrics.length ? (
          <table className="tabular-nums">
            <thead>
              <tr className="text-ink-2 text-left">
                <th className="font-medium pr-4">State</th>
                <th className="font-medium pr-4">Relative L2</th>
                <th className="font-medium">Max |Δ|</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {metrics.map(([n, m]) => (
                <tr key={n}>
                  <td className="pr-4">{n}</td>
                  <td className="pr-4">{m.rel_l2 == null ? "—" : m.rel_l2.toExponential(3)}</td>
                  <td>{m.max_abs.toExponential(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">{result.reference?.error ?? "No reference was requested for this run."}</p>
        )}
        {result.reference?.label && <p className="mt-2 text-[11.5px] text-muted">Reference: {result.reference.label}</p>}

        <h3 className="panel-title mt-5 mb-2">Warnings</h3>
        {result.warnings.length ? (
          <ul className="list-disc pl-5 text-warn">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">None reported by adalib.</p>
        )}
      </div>
      <div>
        <h3 className="panel-title mb-2">Run</h3>
        <table>
          <tbody>
            {kv("adalib version", result.adalib_version)}
            {kv("API", "adalib.run_forward")}
            {kv("system", result.system.name)}
            {kv("t span", `[${result.t_span.join(", ")}]`)}
            {kv("x0", result.system.x0.join(", "))}
            {Object.entries(result.system.parameters).map(([k, v]) => kv(`param ${k}`, v))}
            {kv("training time (adalib)", `${Number(meta.runtime_sec).toFixed(2)} s`)}
            {kv("worker wall time", `${result.wall_time_sec.toFixed(2)} s`)}
            {kv("points returned", result.n_points)}
            {kv("returned dtype", result.dtype_returned)}
            {Object.entries(meta)
              .filter(([k]) => !["runtime_sec", "lb", "ub", "t_step", "ode_num", "Nt_total"].includes(k))
              .map(([k, v]) => kv(k, v))}
          </tbody>
        </table>
        {result.dtype_returned === "float32" && (
          <p className="mt-2 text-[11.5px] text-muted">
            adalib 0.1.0 returns trajectories as float32 regardless of the training precision.
          </p>
        )}
      </div>
    </div>
  );
}
