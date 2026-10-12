// Reusable chart builders. Every series comes from a worker result (ADA output,
// adalib's reference solve, or adalib's logged losses); derived quantities are
// labelled as such.
import type { ForwardResult, InverseResult, MPCResult, MPCRun, OperatorManifest, OperatorPrediction, OperatorTrainResult, StageRecord } from "../types/api";
import { baseLayout, markerLine, predLine, refLine, type PlotSpec, type Tokens } from "./theme";

type Series = (number | null)[];

/** Color follows the entity (state index), never its rank among visible series. */
export function stateColor(t: Tokens, i: number) {
  return t.series[i % t.series.length];
}

export function trajectoryPlot(
  t: Tokens,
  time: Series,
  states: { name: string; y: Series; ref?: Series | null }[],
  allNames: string[],
  opts: { refLabel?: string; title?: string } = {},
): PlotSpec {
  const data: Record<string, unknown>[] = [];
  for (const s of states) {
    const c = stateColor(t, allNames.indexOf(s.name));
    const ada = {
      type: "scatter",
      mode: "lines",
      x: time,
      y: s.y,
      name: `${s.name} (ADA)`,
      line: predLine(t, c, !!s.ref),
      hovertemplate: "%{y:.6g}",
    };
    if (!s.ref) {
      data.push(ada);
      continue;
    }
    const ref = {
      type: "scatter",
      mode: "lines",
      x: time,
      y: s.ref,
      // paper: every reference is the same black line, so list it once
      name: t.paper ? opts.refLabel ?? "reference" : `${s.name} (${opts.refLabel ?? "reference"})`,
      legendgroup: t.paper ? "ref" : undefined,
      showlegend: t.paper ? !data.some((d) => d.legendgroup === "ref") : undefined,
      line: refLine(t, c),
      opacity: t.paper ? 1 : 0.85,
      hovertemplate: "%{y:.6g}",
    };
    // paper: black reference underneath the dashed prediction
    if (t.paper) data.push(ref, ada);
    else data.push(ada, ref);
  }
  return {
    data,
    layout: baseLayout(t, {
      xaxis: { ...baseLayout(t).xaxis, title: { text: "t", font: { color: t.ink2 } } },
      yaxis: { ...baseLayout(t).yaxis, title: { text: "state value", font: { color: t.ink2 } } },
      showlegend: true,
    }),
  };
}

export function phasePlot(t: Tokens, r: ForwardResult, xName: string, yName: string): PlotSpec {
  const data: Record<string, unknown>[] = [
    {
      type: "scatter",
      mode: "lines",
      x: r.y[xName],
      y: r.y[yName],
      name: "ADA",
      line: predLine(t, t.paper ? t.pred : t.series[0], !!r.reference?.y),
      hovertemplate: `${xName}=%{x:.6g}<br>${yName}=%{y:.6g}<extra>ADA</extra>`,
    },
    {
      type: "scatter",
      mode: "markers",
      x: [r.y[xName][0]],
      y: [r.y[yName][0]],
      name: "initial state",
      marker: t.paper
        ? { color: "#fff", size: 8, symbol: "circle", line: { color: "#000", width: 1.2 } }
        : { color: t.series[0], size: 9, line: markerLine(t) },
      hovertemplate: `t=${r.t[0]}<extra>initial state</extra>`,
    },
  ];
  const ref = r.reference?.y;
  if (ref) {
    data.splice(t.paper ? 0 : 1, 0, {
      type: "scatter",
      mode: "lines",
      x: ref[xName],
      y: ref[yName],
      name: "reference (BDF)",
      line: refLine(t, t.series[1]),
      hovertemplate: `${xName}=%{x:.6g}<br>${yName}=%{y:.6g}<extra>reference</extra>`,
    });
  }
  const base = baseLayout(t);
  return {
    data,
    layout: baseLayout(t, {
      hovermode: "closest",
      xaxis: { ...base.xaxis, title: { text: xName, font: { color: t.ink2 } } },
      yaxis: { ...base.yaxis, title: { text: yName, font: { color: t.ink2 } } },
      showlegend: true,
    }),
  };
}

/** Per-stage residual loss exactly as adalib printed it. */
export function lossPlot(t: Tokens, history: StageRecord[]): PlotSpec {
  const stages: ("Adam" | "L-BFGS")[] = ["Adam", "L-BFGS"];
  const unit = history.find((h) => h.unit !== "full")?.unit ?? "segment";
  // LPA's single "[full]" L-BFGS stage runs after the last epoch: plot it there
  const lastIndex = Math.max(0, ...history.map((h) => h.index ?? 0));
  const data = stages
    .map((stage, si) => {
      const recs = history.filter((h) => h.stage === stage);
      if (!recs.length) return null;
      return {
        type: "scatter",
        mode: recs.length > 1 ? "lines+markers" : "markers",
        x: recs.map((h) => (h.index ?? lastIndex) + 1),
        y: recs.map((h) => h.loss),
        name: `after ${stage}`,
        line: { color: t.series[si], width: 2 },
        marker: { color: t.series[si], size: 8, line: markerLine(t) },
        hovertemplate: `${unit} %{x}: %{y:.3e}<extra>after ${stage}</extra>`,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];
  const base = baseLayout(t);
  return {
    data,
    layout: baseLayout(t, {
      hovermode: "x unified",
      xaxis: { ...base.xaxis, title: { text: unit === "segment" ? "segment" : "epoch", font: { color: t.ink2 } } },
      yaxis: {
        ...base.yaxis,
        type: "log",
        exponentformat: "power",
        title: { text: "residual loss (sum over equations)", font: { color: t.ink2 } },
      },
      showlegend: true,
    }),
  };
}

/** |ADA − reference| per state — a derived quantity on the returned grid. */
export function errorPlot(t: Tokens, r: ForwardResult): PlotSpec | null {
  const ref = r.reference?.y;
  if (!ref) return null;
  const names = r.system.state_names;
  const data = names.map((n, i) => ({
    type: "scatter",
    mode: "lines",
    x: r.t,
    y: r.y[n].map((v, k) => (v === null || ref[n][k] === null ? null : Math.abs(v - (ref[n][k] as number)))),
    name: n,
    line: { color: stateColor(t, i), width: 2 },
    hovertemplate: "%{y:.3e}",
  }));
  const base = baseLayout(t);
  return {
    data,
    layout: baseLayout(t, {
      xaxis: { ...base.xaxis, title: { text: "t", font: { color: t.ink2 } } },
      yaxis: {
        ...base.yaxis,
        type: "log",
        exponentformat: "power",
        title: { text: "|ADA − reference|", font: { color: t.ink2 } },
      },
      showlegend: names.length > 1,
    }),
  };
}

// ── operator ─────────────────────────────────────────────────────────────

export function operatorLossPlot(t: Tokens, history: NonNullable<OperatorTrainResult["history"]>): PlotSpec {
  const train = history.phys_loss ?? [];
  const x = history.epoch ?? train.map((_, i) => i + 1);
  const series = [
    { name: "training", y: train, c: t.series[0] },
    { name: "validation", y: history.val_phys_loss ?? [], c: t.series[1] },
  ].filter((s) => s.y.some((v) => v != null));
  const sparse = x.length < 40;
  const base = baseLayout(t);
  return {
    data: series.map((s) => ({
      type: "scatter",
      mode: sparse ? "lines+markers" : "lines",
      x,
      y: s.y,
      name: s.name,
      line: { color: s.c, width: 2 },
      marker: { color: s.c, size: 8, line: markerLine(t) },
      hovertemplate: "%{y:.3e}",
    })),
    layout: baseLayout(t, {
      xaxis: { ...base.xaxis, title: { text: "epoch", font: { color: t.ink2 } } },
      yaxis: { ...base.yaxis, type: "log", exponentformat: "power", title: { text: "physics loss", font: { color: t.ink2 } } },
      showlegend: series.length > 1,
    }),
  };
}

/** One panel per state (states differ in scale); each prediction is one
 *  colour slot, operator points solid with markers, reference dashed. */
export function predictionsPlot(t: Tokens, m: OperatorManifest, preds: { label: string; p: OperatorPrediction }[]): PlotSpec {
  const names = m.state_names;
  const n = names.length;
  const gap = 0.06;
  const h = (1 - gap * (n - 1)) / n;
  const data: Record<string, unknown>[] = [];
  const base = baseLayout(t);
  const layout: Record<string, unknown> = baseLayout(t, { hovermode: "x unified", showlegend: true, margin: { l: 64, r: 16, t: 28, b: 44 } });
  const unit = m.time_unit ? ` [${m.time_unit}]` : "";
  names.forEach((name, i) => {
    const ax = i === 0 ? "" : String(i + 1);
    const top = 1 - i * (h + gap);
    layout[`yaxis${ax}`] = {
      ...base.yaxis,
      domain: [top - h, top],
      title: { text: name, font: { color: t.ink2, size: 12 } },
    };
    layout[`xaxis${ax}`] = {
      ...base.xaxis,
      anchor: `y${ax}`,
      matches: i === 0 ? undefined : "x",
      showticklabels: i === n - 1,
      title: i === n - 1 ? { text: `t${unit}`, font: { color: t.ink2 } } : undefined,
    };
    preds.forEach(({ label, p }, k) => {
      const c = t.series[k % t.series.length];
      const ref = p.reference?.y?.[name];
      if (ref && p.reference?.t) {
        data.push({
          type: "scatter", mode: "lines", x: p.reference.t, y: ref, xaxis: `x${ax}`, yaxis: `y${ax}`,
          name: `${label} reference`, legendgroup: `${label}-ref`, showlegend: i === 0,
          line: refLine(t, c), opacity: t.paper ? 1 : 0.85, hovertemplate: "%{y:.5g}",
        });
      }
      data.push({
        type: "scatter", mode: "lines+markers", x: p.t, y: p.y[name], xaxis: `x${ax}`, yaxis: `y${ax}`,
        name: `${label} operator`, legendgroup: `${label}-op`, showlegend: i === 0,
        line: t.paper ? predLine(t, c, !!ref) : { color: c, width: 2 }, marker: { color: c, size: t.paper ? 5 : 6 }, hovertemplate: "%{y:.5g}",
      });
    });
  });
  return { data, layout };
}

// ── shared: vertically stacked panels with a common x axis ─────────────────
function stacked(t: Tokens, panels: string[], xTitle: string, extra: Record<string, unknown> = {}) {
  const n = panels.length;
  const gap = n > 1 ? 0.06 : 0;
  const h = (1 - gap * (n - 1)) / n;
  const base = baseLayout(t);
  const layout: Record<string, unknown> = baseLayout(t, { hovermode: "x unified", showlegend: true, margin: { l: 64, r: 16, t: 28, b: 44 }, ...extra });
  const axes = panels.map((title, i) => {
    const ax = i === 0 ? "" : String(i + 1);
    const top = 1 - i * (h + gap);
    layout[`yaxis${ax}`] = { ...base.yaxis, domain: [top - h, top], title: { text: title, font: { color: t.ink2, size: 12 } } };
    layout[`xaxis${ax}`] = {
      ...base.xaxis,
      anchor: `y${ax}`,
      matches: i === 0 ? undefined : "x",
      showticklabels: i === n - 1,
      title: i === n - 1 ? { text: xTitle, font: { color: t.ink2 } } : undefined,
    };
    return { x: `x${ax}`, y: `y${ax}`, yKey: `yaxis${ax}` };
  });
  return { layout, axes };
}

// ── inverse ──────────────────────────────────────────────────────────────

export function inverseFitPlot(t: Tokens, r: InverseResult): PlotSpec {
  const names = r.system.state_names;
  const { layout, axes } = stacked(t, names, "t");
  const data: Record<string, unknown>[] = [];
  names.forEach((n, i) => {
    const { x, y } = axes[i];
    const first = i === 0;
    const obs = r.observations.y[n];
    if (r.check.y) {
      data.push({ type: "scatter", mode: "lines", x: r.t, y: r.check.y[n], xaxis: x, yaxis: y, name: "scipy check (estimated params)", legendgroup: "check", showlegend: first, line: t.paper ? { color: t.ref, width: 1.2, dash: "dash" } : { color: t.series[1], width: 1.5, dash: "dash" }, hovertemplate: "%{y:.5g}" });
    }
    data.push({ type: "scatter", mode: "lines", x: r.t, y: r.y[n], xaxis: x, yaxis: y, name: "ADA fit", legendgroup: "ada", showlegend: first, line: { color: t.pred, width: t.paper ? 1.8 : 2 }, hovertemplate: "%{y:.5g}" });
    if (obs) {
      data.push({ type: "scatter", mode: "markers", x: r.observations.t, y: obs, xaxis: x, yaxis: y, name: "observations", legendgroup: "obs", showlegend: !data.some((d) => d.legendgroup === "obs" && d.showlegend), marker: t.paper ? { color: "#000", size: 6, symbol: "circle-open", line: { width: 1 } } : { color: t.ink2, size: 5, opacity: 0.7 }, hovertemplate: "%{y:.5g}" });
    }
  });
  return { data, layout };
}

export function inverseParamPlot(t: Tokens, r: InverseResult): PlotSpec {
  const unknown = r.parameters.filter((p) => p.estimated);
  const { layout, axes } = stacked(t, unknown.map((p) => p.name), "optimizer step");
  const data: Record<string, unknown>[] = [];
  unknown.forEach((p, i) => {
    const h = r.history.params[p.name];
    const { x, y } = axes[i];
    if (h) data.push({ type: "scatter", mode: "lines", x: h.step, y: h.value, xaxis: x, yaxis: y, name: "estimate", legendgroup: "est", showlegend: i === 0, line: { color: t.pred, width: t.paper ? 1.8 : 2 }, hovertemplate: "%{y:.6g}" });
    if (p.reference != null && h?.step.length) {
      data.push({ type: "scatter", mode: "lines", x: [h.step[0], h.step[h.step.length - 1]], y: [p.reference, p.reference], xaxis: x, yaxis: y, name: "reference value", legendgroup: "ref", showlegend: !data.some((d) => d.legendgroup === "ref"), line: t.paper ? { color: t.ref, width: 1.2, dash: "dash" } : { color: t.series[1], width: 1.5, dash: "dash" }, hovertemplate: "%{y:.6g}" });
    }
  });
  return { data, layout };
}

export function inverseLossPlot(t: Tokens, r: InverseResult): PlotSpec {
  const h = r.history;
  const base = baseLayout(t);
  const series = [
    { name: "total", y: h.total, c: t.series[0] },
    { name: "physics", y: h.physics, c: t.series[1] },
    { name: "data", y: h.data, c: t.series[2] },
  ];
  return {
    data: series.map((s) => ({ type: "scatter", mode: "lines", x: h.step, y: s.y, name: s.name, line: { color: s.c, width: 2 }, hovertemplate: "%{y:.3e}" })),
    layout: baseLayout(t, {
      xaxis: { ...base.xaxis, title: { text: "optimizer step", font: { color: t.ink2 } } },
      yaxis: { ...base.yaxis, type: "log", exponentformat: "power", title: { text: "loss", font: { color: t.ink2 } } },
      showlegend: true,
    }),
  };
}

export function residualPlot(t: Tokens, r: InverseResult): PlotSpec {
  const names = Object.keys(r.residuals.y);
  const { layout, axes } = stacked(t, names.map((n) => `${n} residual`), "t", { hovermode: "closest", showlegend: false });
  const data: Record<string, unknown>[] = [];
  names.forEach((n, i) => {
    const { x, y } = axes[i];
    const ts = r.residuals.t;
    data.push({ type: "scatter", mode: "lines", x: [ts[0], ts[ts.length - 1]], y: [0, 0], xaxis: x, yaxis: y, line: { color: t.axis, width: 1 }, hoverinfo: "skip" });
    data.push({ type: "scatter", mode: "markers", x: ts, y: r.residuals.y[n], xaxis: x, yaxis: y, name: n, marker: { color: t.paper ? t.err : t.series[0], size: 6 }, hovertemplate: "t=%{x:.4g}<br>obs − fit = %{y:.3e}<extra></extra>" });
  });
  return { data, layout };
}

// ── MPC ──────────────────────────────────────────────────────────────────
const unitLabel = (u: string) => (u ? `t [${u}]` : "t");

/** Controllers of a result; a one-shot result is a single unnamed run. */
export function mpcRuns(r: MPCResult): MPCRun[] {
  if (r.runs?.length) return r.runs;
  const label = r.options.optimizer !== "SLSQP" ? r.options.optimizer : r.options.gradient === "autodiff" ? "AD" : r.options.gradient === "fd" ? "FD" : "SLSQP";
  return [{ label, gradient: r.options.gradient, optimizer: r.options.optimizer, t: r.t, x: r.x, u: r.u, cost: r.cost, tracking: r.tracking, economic: r.economic, metadata: r.metadata, wall_time_sec: r.wall_time_sec }];
}

/** One colour per controller; a single controller keeps the role colour. */
function runColor(t: Tokens, runs: MPCRun[], k: number, single: string) {
  return runs.length > 1 ? t.series[k % t.series.length] : single;
}

export function mpcStatesPlot(t: Tokens, r: MPCResult): PlotSpec {
  const names = r.system.state_names;
  const runs = mpcRuns(r);
  const multi = runs.length > 1;
  const { layout, axes } = stacked(t, names, unitLabel(r.time_unit));
  const data: Record<string, unknown>[] = [];
  names.forEach((n, i) => {
    const { x, y } = axes[i];
    runs.forEach((run, k) => {
      const c = runColor(t, runs, k, t.series[0]);
      data.push({ type: "scatter", mode: multi ? "lines" : "lines+markers", x: run.t, y: run.x[n], xaxis: x, yaxis: y, name: multi ? run.label : "plant state", legendgroup: `x${k}`, showlegend: i === 0, line: { color: c, width: t.paper ? 1.8 : 2 }, marker: { color: c, size: t.paper ? 4 : 5 }, hovertemplate: `%{y:.5g}<extra>${run.label}</extra>` });
    });
    const ref = r.targets[n];
    if (ref != null) {
      const t0 = runs[0].t;
      data.push({ type: "scatter", mode: "lines", x: [t0[0], t0[t0.length - 1]], y: [ref, ref], xaxis: x, yaxis: y, name: "target", legendgroup: "ref", showlegend: !data.some((d) => d.legendgroup === "ref"), line: { color: t.tgt, width: 1.5, dash: "dash" }, hovertemplate: "target %{y:.5g}" });
    }
  });
  return { data, layout };
}

/** Piecewise-constant inputs: each u_k is held over [t_k, t_k+1). */
export function mpcControlsPlot(t: Tokens, r: MPCResult): PlotSpec {
  const names = r.system.control_names;
  const runs = mpcRuns(r);
  const multi = runs.length > 1;
  const { layout, axes } = stacked(t, names, unitLabel(r.time_unit));
  const data: Record<string, unknown>[] = [];
  names.forEach((n, i) => {
    const { x, y } = axes[i];
    let xs: Series = [];
    runs.forEach((run, k) => {
      const u = run.u[n];
      xs = run.t.slice(0, u.length + 1);
      data.push({ type: "scatter", mode: "lines", line: { shape: "hv", color: runColor(t, runs, k, t.ctrl), width: t.paper ? 1.8 : 2 }, x: xs, y: [...u, u[u.length - 1]], xaxis: x, yaxis: y, name: multi ? run.label : "control (held per step)", legendgroup: `u${k}`, showlegend: i === 0, hovertemplate: `%{y:.5g}<extra>${run.label}</extra>` });
    });
    const b = r.control_bounds[n];
    if (b) {
      for (const [k, v] of b.entries()) {
        data.push({ type: "scatter", mode: "lines", x: [xs[0], xs[xs.length - 1]], y: [v, v], xaxis: x, yaxis: y, name: "bounds", legendgroup: "b", showlegend: i === 0 && k === 0, line: { color: t.paper ? "#7f7f7f" : t.muted, width: 1, dash: "dot" }, hovertemplate: `${k === 0 ? "lower" : "upper"} bound %{y:.5g}` });
      }
    }
  });
  return { data, layout };
}

export function mpcCostPlot(t: Tokens, r: MPCResult): PlotSpec {
  const base = baseLayout(t);
  const runs = mpcRuns(r);
  const multi = runs.length > 1;
  const n = Math.max(...runs.map((run) => run.cost.length));
  return {
    data: runs.map((run, k) => {
      const c = runColor(t, runs, k, t.cost);
      return { type: "scatter", mode: "lines+markers", x: run.cost.map((_, i) => i + 1), y: run.cost, name: multi ? run.label : "objective", line: { color: c, width: t.paper ? 1.8 : 2 }, marker: { color: c, size: t.paper ? 5 : 7, line: markerLine(t) }, hovertemplate: `step %{x}: %{y:.4g}<extra>${run.label}</extra>` };
    }),
    layout: baseLayout(t, {
      hovermode: "closest",
      xaxis: { ...base.xaxis, title: { text: "MPC step", font: { color: t.ink2 } }, dtick: n <= 20 ? 1 : undefined },
      yaxis: { ...base.yaxis, title: { text: r.mode === "economic" ? "optimizer objective (economic)" : "optimizer objective J", font: { color: t.ink2 } } },
      showlegend: multi,
    }),
  };
}
