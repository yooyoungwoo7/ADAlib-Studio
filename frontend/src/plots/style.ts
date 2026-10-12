// User / AI figure style on top of the Paper or Screen look (backend schema: schemas/plot_style.py).
// Font sizes are points, export sizes centimetres.
import type { PlotStyle } from "../types/api";
import type { PlotSpec, Tokens } from "./theme";

export type Trace = Record<string, unknown> & { meta?: { state: string; kind: "ada" | "ref" } };
type Layout = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PX_PER_PT = 96 / 72;
const px = (pt: number | undefined) => (pt == null ? undefined : Math.round(pt * PX_PER_PT * 10) / 10);

export const isStyled = (s: PlotStyle | undefined) => !!s && Object.keys(s).length > 0;

/** Legend placement inside (corners), above (top) or beside (right) the axes. */
function legendAt(pos: NonNullable<PlotStyle["legend_position"]>) {
  const corner = (x: number, y: number, xa: string, ya: string) => ({ orientation: "v", x, y, xanchor: xa, yanchor: ya, xref: "paper", yref: "paper" });
  switch (pos) {
    case "top-left":
      return corner(0.02, 0.98, "left", "top");
    case "top-right":
      return corner(0.98, 0.98, "right", "top");
    case "bottom-left":
      return corner(0.02, 0.02, "left", "bottom");
    case "bottom-right":
      return corner(0.98, 0.02, "right", "bottom");
    case "right":
      return { orientation: "v", x: 1.02, y: 1, xanchor: "left", yanchor: "top", xref: "paper", yref: "paper" };
    default:
      return { orientation: "h", x: 0, y: 1.02, xanchor: "left", yanchor: "bottom", xref: "paper", yref: "paper" };
  }
}

/**
 * Apply a style to a trajectory figure. `panel` names the state of a per-state panel; without it
 * the figure is the combined plot. Traces carry meta {state, kind} (set by trajectoryPlot).
 */
export function applyTrajectoryStyle(t: Tokens, spec: PlotSpec, style: PlotStyle | undefined, panel?: string): PlotSpec {
  if (!isStyled(style)) return spec;
  const s = style!;
  const data = (spec.data as Trace[])
    .filter((d) => !(d.meta?.kind === "ref" && s.show_reference === false))
    .map((d) => {
      if (!d.meta) return d;
      const { state, kind } = d.meta;
      const line = { ...(d.line as object) } as Record<string, unknown>;
      let name = d.name as string;
      if (kind === "ada") {
        if (s.colors?.[state]) line.color = s.colors[state];
        if (s.line_width != null) line.width = s.line_width;
        if (s.dashes?.[state]) line.dash = s.dashes[state];
        if (s.ada_label) name = panel ? s.ada_label : `${state} (${s.ada_label})`;
      } else {
        if (s.ref_color) line.color = s.ref_color;
        if (s.ref_line_width != null) line.width = s.ref_line_width;
        if (s.ref_dash) line.dash = s.ref_dash;
        if (s.ref_label) name = t.paper || panel ? s.ref_label : `${state} (${s.ref_label})`;
      }
      return { ...d, line, name };
    });

  const L: Layout = structuredClone(spec.layout);
  const font = px(s.font_size);
  if (s.font_family || font) L.font = { ...L.font, ...(s.font_family ? { family: s.font_family } : {}), ...(font ? { size: font } : {}) };
  for (const ax of ["xaxis", "yaxis"]) {
    const a = (L[ax] = { ...L[ax] });
    a.title = { ...(a.title ?? {}), font: { ...(a.title?.font ?? {}), ...(font ? { size: font } : {}), ...(s.font_family ? { family: s.font_family } : {}) } };
    const tick = px(s.tick_font_size ?? s.font_size);
    if (tick || s.font_family) a.tickfont = { ...(a.tickfont ?? {}), ...(tick ? { size: tick } : {}), ...(s.font_family ? { family: s.font_family } : {}) };
    if (s.grid != null) {
      a.showgrid = s.grid;
      if (s.grid && t.paper) a.gridcolor = "#d9d9d9";
    }
  }
  L.xaxis.title.text = s.x_title ?? L.xaxis.title.text;
  if (panel) {
    if (s.y_titles?.[panel]) L.yaxis.title.text = s.y_titles[panel];
    if (s.panel_titles?.[panel] && L.title) L.title = { ...L.title, text: s.panel_titles[panel] };
  } else {
    if (s.y_title) L.yaxis.title.text = s.y_title;
    if (s.title) {
      L.title = { text: s.title, x: 0.5, xanchor: "center", font: { size: px(s.title_font_size ?? (s.font_size ?? 12) * 1.15) } };
      L.margin = { ...L.margin, t: Math.max(L.margin?.t ?? 0, 70) };
    }
  }
  if (panel && L.title && (s.title_font_size || s.font_family))
    L.title = { ...L.title, font: { ...(L.title.font ?? {}), ...(s.title_font_size ? { size: px(s.title_font_size) } : {}), ...(s.font_family ? { family: s.font_family } : {}) } };
  if (s.x_range) L.xaxis.range = s.x_range;
  if (s.y_range) L.yaxis.range = s.y_range;
  if (s.log_y) L.yaxis.type = "log";

  if (s.legend_position === "hidden") L.showlegend = false;
  else {
    const legend = { ...(L.legend ?? {}) };
    if (s.legend_position) Object.assign(legend, legendAt(s.legend_position));
    if (s.legend_box != null) legend.borderwidth = s.legend_box ? 0.8 : 0;
    if (s.legend_box) legend.bordercolor = t.paper ? "#000" : t.axis;
    const lf = px(s.legend_font_size ?? s.font_size);
    if (lf || s.font_family) legend.font = { ...(legend.font ?? {}), ...(lf ? { size: lf } : {}), ...(s.font_family ? { family: s.font_family } : {}) };
    L.legend = legend;
    if (s.legend_position === "right") L.margin = { ...L.margin, r: Math.max(L.margin?.r ?? 0, 150) };
  }
  return { data, layout: L };
}

export interface ExportOptions {
  format: "png" | "svg";
  width?: number;
  height?: number;
  scale: number;
}

/** Save size from the style: cm -> CSS px at 96 dpi, dpi -> scale. Without a size, the chart's own. */
export function exportOptions(style: PlotStyle | undefined): ExportOptions {
  const cm = (v: number | undefined) => (v == null ? undefined : Math.round((v / 2.54) * 96));
  return {
    format: style?.export_format ?? "png",
    width: cm(style?.export_width_cm),
    height: cm(style?.export_height_cm),
    scale: style?.export_dpi ? style.export_dpi / 96 : 2,
  };
}

/** "8 × 6 cm · 600 dpi · SVG" */
export function exportSummary(style: PlotStyle | undefined) {
  if (!style) return "";
  const parts: string[] = [];
  if (style.export_width_cm && style.export_height_cm) parts.push(`${style.export_width_cm} × ${style.export_height_cm} cm`);
  else if (style.export_width_cm) parts.push(`width ${style.export_width_cm} cm`);
  else if (style.export_height_cm) parts.push(`height ${style.export_height_cm} cm`);
  if (style.export_dpi) parts.push(`${style.export_dpi} dpi`);
  if (style.export_format) parts.push(style.export_format.toUpperCase());
  return parts.join(" · ");
}
