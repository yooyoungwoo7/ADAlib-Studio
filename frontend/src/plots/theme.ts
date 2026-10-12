// Chart theming, kept free of Plotly imports so builders are testable.
export interface PlotSpec {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
}

/** "paper" mimics the manuscript figures (adalib utils/_style.py): Times serif,
 *  closed box with inward major+minor ticks, no grid, white background, black
 *  reference lines and matplotlib tab10 colours. "screen" follows the app theme. */
export type PlotStyle = "paper" | "screen";

export function currentPlotStyle(): PlotStyle {
  return document.documentElement.getAttribute("data-plot-style") === "screen" ? "screen" : "paper";
}

// matplotlib tab10 without C2 (green is reserved for cost), as in adalib's _STATE_COLORS
const TAB10 = ["#1f77b4", "#ff7f0e", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22"];

/** Reads the current theme tokens so charts follow light/dark and the plot style. */
export function chartTokens() {
  if (currentPlotStyle() === "paper") {
    return {
      paper: true,
      surface: "#ffffff",
      ink: "#000000",
      ink2: "#000000",
      muted: "#555555",
      grid: "#ffffff",
      axis: "#000000",
      series: TAB10,
      ref: "#000000", // reference / ground truth
      pred: "#C0392B", // single-series ADA prediction
      ctrl: "#534AB7", // control input
      cost: "#27AE60", // objective
      tgt: "#ff0000", // set-point
      err: "#E67E22", // error
    };
  }
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const series = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`));
  return {
    paper: false,
    surface: v("--chart-surface"),
    ink: v("--ink"),
    ink2: v("--ink-2"),
    muted: v("--muted"),
    grid: v("--grid"),
    axis: v("--axis"),
    series,
    ref: series[1],
    pred: series[0],
    ctrl: series[0],
    cost: series[0],
    tgt: series[1],
    err: series[0],
  };
}

export type Tokens = ReturnType<typeof chartTokens>;

/** Reference / ground-truth line. Paper: black solid under the prediction. */
export function refLine(t: Tokens, c: string) {
  return t.paper ? { color: t.ref, width: 1.8 } : { color: c, width: 1.5, dash: "dash" };
}

/** Model prediction compared against a reference. Paper: coloured dashed. */
export function predLine(t: Tokens, c: string, hasRef = true) {
  return t.paper && hasRef ? { color: c, width: 1.5, dash: "dash" } : { color: c, width: t.paper ? 1.8 : 2 };
}

/** Marker outline: a halo on screen, none on paper. */
export function markerLine(t: Tokens) {
  return t.paper ? { width: 0 } : { color: t.surface, width: 2 };
}

const PAPER_FONT = '"Times New Roman", Times, "STIX Two Text", "DejaVu Serif", serif';

export function baseLayout(t: Tokens, extra: Record<string, unknown> = {}) {
  if (t.paper) {
    const axis = {
      showgrid: false,
      zeroline: false,
      showline: true,
      mirror: "ticks",
      linecolor: "#000",
      linewidth: 1,
      ticks: "inside",
      ticklen: 6,
      tickwidth: 1,
      tickcolor: "#000",
      minor: { ticks: "inside", ticklen: 3, tickwidth: 0.8, tickcolor: "#000", showgrid: false },
      tickfont: { color: "#000", size: 13 },
      title: { font: { color: "#000", size: 15 } },
      automargin: true,
    };
    return {
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      font: { family: PAPER_FONT, color: "#000", size: 14 },
      margin: { l: 64, r: 20, t: 36, b: 48 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: "#fff", bordercolor: "#000", font: { family: PAPER_FONT, color: "#000", size: 13 } },
      // boxed like matplotlib's legend, but above the axes so it never hides data
      legend: {
        orientation: "h", x: 0, y: 1.02, xanchor: "left", yanchor: "bottom",
        bgcolor: "rgba(255,255,255,0.7)", bordercolor: "#000", borderwidth: 0.8,
        font: { family: PAPER_FONT, color: "#000", size: 13 },
      },
      xaxis: { ...axis },
      yaxis: { ...axis },
      ...extra,
    };
  }
  const axis = {
    gridcolor: t.grid,
    linecolor: t.axis,
    zerolinecolor: t.axis,
    tickcolor: t.axis,
    tickfont: { color: t.muted, size: 11 },
    title: { font: { color: t.ink2, size: 12 } },
    showline: true,
    automargin: true,
  };
  return {
    paper_bgcolor: t.surface,
    plot_bgcolor: t.surface,
    font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: t.ink2, size: 12 },
    margin: { l: 56, r: 16, t: 28, b: 44 },
    hovermode: "x unified",
    hoverlabel: { bgcolor: t.surface, bordercolor: t.axis, font: { color: t.ink, size: 12 } },
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { color: t.ink2, size: 12 } },
    xaxis: { ...axis },
    yaxis: { ...axis },
    ...extra,
  };
}
