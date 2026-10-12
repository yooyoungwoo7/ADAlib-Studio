import { useMemo, useState } from "react";
import { Icon, ICONS } from "../../components/common/controls";
import { inverseFitPlot, inverseLossPlot, inverseParamPlot, residualPlot } from "../../plots/charts";
import { chartTokens, Plot } from "../../plots/Plot";
import { api } from "../../services/api";
import type { InverseResult } from "../../types/api";

type Tab = "params" | "fit" | "history" | "loss" | "residuals";

const g = (v: number | null | undefined, p = 6) => (v == null ? "—" : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : String(+v.toPrecision(p)));

export function InverseResults({ jobId, r, themeKey }: { jobId: string; r: InverseResult; themeKey: string }) {
  const [tab, setTab] = useState<Tab>("params");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => chartTokens(), [themeKey]);
  const fit = useMemo(() => inverseFitPlot(t, r), [t, r]);
  const hist = useMemo(() => inverseParamPlot(t, r), [t, r]);
  const loss = useMemo(() => inverseLossPlot(t, r), [t, r]);
  const res = useMemo(() => residualPlot(t, r), [t, r]);
  const base = `${r.system.name}_${jobId}`;
  const tabs: [Tab, string][] = [
    ["params", "Parameters"],
    ["fit", "Fit vs observations"],
    ["history", "Parameter history"],
    ["loss", "Training loss"],
    ["residuals", "Residuals"],
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center border-b border-line shrink-0 overflow-x-auto" role="tablist" aria-label="Inverse result views">
        {tabs.map(([id, label]) => (
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
          {["trajectory.csv", "parameter_history.csv", "loss_history.csv"].map((f) => (
            <a key={f} className="inline-flex items-center gap-1 h-7 px-2 rounded text-[12px] text-ink-2 hover:bg-panel-3 hover:text-ink" href={api.fileUrl(jobId, f)} download>
              <Icon d={ICONS.download} size={12} /> {f.replace(".csv", "")}
            </a>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3" role="tabpanel">
        {tab === "params" && (
          <div className="flex flex-col gap-5 text-[12.5px]">
            <table className="tabular-nums">
              <thead>
                <tr className="text-left text-ink-2">
                  <th className="font-medium pr-5 pb-1">Parameter</th>
                  <th className="font-medium pr-5 pb-1">Estimated / fixed value</th>
                  <th className="font-medium pr-5 pb-1">Initial guess</th>
                  <th className="font-medium pr-5 pb-1">Bounds</th>
                  <th className="font-medium pr-5 pb-1">Reference</th>
                  <th className="font-medium pb-1">Error</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {r.parameters.map((p) => (
                  <tr key={p.name} className={p.estimated ? "" : "text-muted"}>
                    <td className="pr-5 py-0.5">{p.name}</td>
                    <td className="pr-5 py-0.5">
                      {g(p.value)} {p.estimated ? "" : "(fixed)"}
                    </td>
                    <td className="pr-5 py-0.5">{p.estimated ? g(p.initial) : ""}</td>
                    <td className="pr-5 py-0.5">{p.estimated ? `[${p.lower ?? "−∞"}, ${p.upper ?? "∞"}]` : ""}</td>
                    <td className="pr-5 py-0.5">{p.reference != null ? g(p.reference) : ""}</td>
                    <td className="py-0.5">{p.rel_error != null ? `${(p.rel_error * 100).toFixed(2)} %` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <h3 className="panel-title mb-1.5">Fit to observations</h3>
                <table className="tabular-nums font-mono">
                  <thead>
                    <tr className="text-left text-ink-2 font-sans">
                      <th className="font-medium pr-4">State</th>
                      <th className="font-medium pr-4">RMSE</th>
                      <th className="font-medium">Max |residual|</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(r.fit).map(([n, f]) => (
                      <tr key={n}>
                        <td className="pr-4">{n}</td>
                        <td className="pr-4">{f.rmse.toExponential(3)}</td>
                        <td>{f.max_abs.toExponential(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11.5px] text-muted">Residual = observation − ADA trajectory (linearly interpolated) at each observation time.</p>
              </div>
              <div>
                <h3 className="panel-title mb-1.5">Run</h3>
                <ul className="text-ink-2 flex flex-col gap-0.5">
                  <li>
                    Observations: {r.observations.source.n_points} points of {Object.keys(r.observations.y).join(", ")} — {r.observations.source.label}
                    {r.observations.source.kind === "synthetic" ? ` (noise ${r.observations.source.noise_pct} % RMS, seed ${r.observations.source.seed})` : ""}
                  </li>
                  {r.observations.notes.map((n) => (
                    <li key={n} className="text-warn">
                      {n}
                    </li>
                  ))}
                  <li>
                    adalib {r.adalib_version} · run_inverse · {r.options.training_strategy} · {r.history.n_steps} optimizer steps
                  </li>
                  <li>
                    Training {r.runtime_sec.toFixed(1)} s (adalib) · worker {r.wall_time_sec.toFixed(1)} s
                  </li>
                </ul>
                {r.warnings.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-warn">
                    {r.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
        {tab === "fit" && (
          <div className="flex flex-col h-full min-h-[360px] gap-2">
            <p className="text-[12px] text-ink-2">
              ADA trajectory from the inverse run; dashed: {r.check.error ? `check failed (${r.check.error})` : r.check.label}.
            </p>
            <div className="flex-1 min-h-[300px]">
              <Plot spec={fit} figureId="fit" filename={`${base}_fit`} ariaLabel="Fitted trajectories and observations" themeKey={themeKey} />
            </div>
          </div>
        )}
        {tab === "history" && (
          <div className="h-full min-h-[320px]">
            <Plot spec={hist} figureId="parameter_history" filename={`${base}_parameter_history`} ariaLabel="Parameter estimates over optimizer steps" themeKey={themeKey} />
          </div>
        )}
        {tab === "loss" && (
          <div className="flex flex-col h-full min-h-[320px] gap-2">
            <p className="text-[12px] text-ink-2">adalib's loss_history: one entry per Adam step plus one per segment's L-BFGS stage (downsampled for display).</p>
            <div className="flex-1 min-h-[280px]">
              <Plot spec={loss} figureId="loss" filename={`${base}_loss`} ariaLabel="Inverse training loss" themeKey={themeKey} />
            </div>
          </div>
        )}
        {tab === "residuals" && (
          <div className="h-full min-h-[320px]">
            <Plot spec={res} figureId="residuals" filename={`${base}_residuals`} ariaLabel="Residuals at observation times" themeKey={themeKey} />
          </div>
        )}
      </div>
    </div>
  );
}
