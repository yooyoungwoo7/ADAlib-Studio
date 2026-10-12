import { useMemo, useRef, useState } from "react";
import { errorPlot, gridColumns, lossPlot, phasePlot, statePanelPlot, trajectoryPlot } from "../../plots/charts";
import { chartTokens, downloadPlot, Plot } from "../../plots/Plot";
import { exportOptions, exportSummary, isStyled } from "../../plots/style";
import { api } from "../../services/api";
import { download, slug } from "../../project";
import type { ForwardResult, ForwardRunRequest, PlotStyle } from "../../types/api";
import { Button, Icon, ICONS } from "../../components/common/controls";

type Tab = "trajectories" | "phase" | "history" | "error" | "data" | "summary";
type TrajLayout = "combined" | "grid";

// remembered per browser; storage can be unavailable (private mode), so never rely on it
const LAYOUT_KEY = "adalib-studio-trajectory-layout";
function savedLayout(): TrajLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "combined";
  } catch {
    return "combined";
  }
}

export function ForwardResults({
  jobId,
  result,
  request,
  themeKey,
  onRestore,
  plotStyle,
  onResetStyle,
}: {
  jobId: string;
  result: ForwardResult;
  request: ForwardRunRequest | null;
  themeKey: string;
  onRestore?: () => void;
  /** figure style from the AI assistant (trajectory plots) */
  plotStyle?: PlotStyle;
  onResetStyle?: () => void;
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
  const [layout, setLayoutState] = useState<TrajLayout>(savedLayout);
  const setLayout = (l: TrajLayout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* not persisted */
    }
  };
  const [phase, setPhase] = useState<[string, string]>([names[0], names[1] ?? names[0]]);
  const base = `${slug(result.system.name)}_${jobId}`;

  // re-read theme tokens whenever the theme changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => chartTokens(), [themeKey]);

  const shownStates = useMemo(
    () => names.filter((n) => visible.includes(n)).map((n) => ({ name: n, y: result.y[n], ref: result.reference?.y?.[n] ?? null })),
    [result, visible, names],
  );
  const grid = layout === "grid" && shownStates.length > 1;
  const trajSpec = useMemo(
    () => trajectoryPlot(t, result.t, shownStates, names, { refLabel: "reference, BDF", style: plotStyle }),
    [t, result, shownStates, names, plotStyle],
  );
  const exp = useMemo(() => exportOptions(plotStyle), [plotStyle]);
  const styled = isStyled(plotStyle);
  // per state: one figure per state (legend on the first), each saved on its own
  const panelSpecs = useMemo(
    () => (grid ? shownStates.map((s, k) => statePanelPlot(t, result.t, s, names, { refLabel: "reference, BDF", legend: k === 0, style: plotStyle })) : []),
    [t, result, shownStates, names, grid, plotStyle],
  );
  const panelEls = useRef<Record<string, HTMLDivElement | null>>({});
  const [saving, setSaving] = useState(false);
  const saveAll = async (format: "png" | "svg") => {
    setSaving(true);
    try {
      for (const s of shownStates) {
        const el = panelEls.current[s.name];
        if (el) await downloadPlot(el, `${base}_${slug(s.name)}`, { ...exp, format });
      }
    } finally {
      setSaving(false);
    }
  };
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
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                <div className="inline-flex rounded border border-line-strong overflow-hidden" role="group" aria-label="Trajectory layout">
                  {(
                    [
                      ["combined", "One plot"],
                      ["grid", "Per state"],
                    ] as [TrajLayout, string][]
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={layout === id}
                      onClick={() => setLayout(id)}
                      className={`h-6 px-2 text-[12px] cursor-pointer ${layout === id ? "bg-accent text-on-accent" : "bg-panel text-ink-2 hover:bg-panel-2"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {styled && (
                  <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded bg-accent-soft text-ink text-[11.5px]" title="Figure style set by the AI assistant; saved with the project">
                    Custom style{exportSummary(plotStyle) ? ` · export ${exportSummary(plotStyle)}` : ""}
                    {onResetStyle && (
                      <button type="button" className="underline cursor-pointer text-ink-2 hover:text-ink" onClick={onResetStyle}>
                        Reset
                      </button>
                    )}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-3" aria-label="Visible states">
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
              </div>
            )}
            {grid ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1 text-[12px] text-ink-2">
                  <span className="mr-1">Save every panel as a separate file:</span>
                  <Button variant="ghost" disabled={saving} onClick={() => saveAll("png")}>
                    <Icon d={ICONS.download} /> All PNG
                  </Button>
                  <Button variant="ghost" disabled={saving} onClick={() => saveAll("svg")}>
                    <Icon d={ICONS.download} /> All SVG
                  </Button>
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${gridColumns(shownStates.length)}, minmax(0, 1fr))` }}>
                  {shownStates.map((s, k) => (
                    <figure key={s.name} className="relative group border border-line rounded">
                      <Plot
                        spec={panelSpecs[k]}
                        figureId={`trajectory_panel_${s.name}`} filename={`${base}_${slug(s.name)}`}
                        ariaLabel={`Trajectory of ${s.name}`}
                        themeKey={themeKey}
                        className="w-full h-[270px]"
                        exportOptions={exp}
                        elementRef={(el) => {
                          panelEls.current[s.name] = el;
                        }}
                      />
                      <figcaption className="absolute top-1 right-1 flex gap-0.5 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                        {(["png", "svg"] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            className="h-5 px-1.5 rounded text-[10.5px] uppercase bg-panel border border-line text-ink-2 hover:text-ink cursor-pointer"
                            title={`Save ${s.name} as ${f.toUpperCase()}`}
                            aria-label={`Save ${s.name} panel as ${f.toUpperCase()}`}
                            onClick={() => {
                              const el = panelEls.current[s.name];
                              if (el) downloadPlot(el, `${base}_${slug(s.name)}`, { ...exp, format: f });
                            }}
                          >
                            {f}
                          </button>
                        ))}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <Plot spec={trajSpec} figureId="trajectories" filename={`${base}_trajectories`} ariaLabel="State trajectories versus time" themeKey={themeKey} exportOptions={exp} />
              </div>
            )}
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
              <Plot spec={phaseSpec} figureId="phase" filename={`${base}_phase_${phase[0]}_${phase[1]}`} ariaLabel={`Phase portrait ${phase[1]} versus ${phase[0]}`} themeKey={themeKey} />
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
                <Plot spec={lossSpec} figureId="loss" filename={`${base}_training_loss`} ariaLabel="Training loss per stage" themeKey={themeKey} />
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
              <Plot spec={errSpec} figureId="error" filename={`${base}_error`} ariaLabel="Absolute difference from the reference over time" themeKey={themeKey} />
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
