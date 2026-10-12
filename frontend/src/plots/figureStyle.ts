// Free-form figure styling by the AI assistant: Plotly layout / trace patches per figure
// (backend: schemas/figure_style.py checks them). Applied on top of the Paper/Screen look.
import { createContext } from "react";
import type { ExportOptions } from "./style";
import type { PlotSpec } from "./theme";

export interface FigureExport {
  width_cm?: number;
  height_cm?: number;
  dpi?: number;
  format?: "png" | "svg";
}

/** One figure's patch. `layout` is deep-merged into the Plotly layout ("xaxes"/"yaxes" reach every
 *  x/y axis of the figure); `traces` maps a selector to trace attributes. */
export interface FigurePatch {
  layout?: Record<string, unknown>;
  traces?: Record<string, Record<string, unknown>>;
  export?: FigureExport;
}

/** figure id, "prefix*" or "*" (every figure of the module) -> patch */
export type FigureStyle = Record<string, FigurePatch>;

/** What the assistant is told about a figure on screen. */
export interface FigureInfo {
  id: string;
  title: string;
  layout: Record<string, unknown>;
  traces: Record<string, unknown>[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Objects merge key by key; anything else (arrays, numbers, strings) replaces. */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(patch)) return patch;
  const out: Obj = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

const matchesId = (key: string, id: string) => key === "*" || key === id || (key.endsWith("*") && id.startsWith(key.slice(0, -1)));

/** "*", "#2", "name:x (ADA)", "axis:y2", "legendgroup:g" */
function matchesTrace(sel: string, t: Obj, i: number) {
  if (sel === "*") return true;
  if (sel.startsWith("#")) return Number(sel.slice(1)) === i;
  const [kind, ...rest] = sel.split(":");
  const val = rest.join(":");
  if (kind === "name") return t.name === val;
  if (kind === "legendgroup") return t.legendgroup === val;
  if (kind === "axis") return val.startsWith("x") ? (t.xaxis ?? "x") === val : (t.yaxis ?? "y") === val;
  return false;
}

/** The patches that apply to a figure, broad first ("*", then prefixes, then the exact id). */
function patchesFor(style: FigureStyle | undefined, id: string): FigurePatch[] {
  if (!style) return [];
  const rank = (k: string) => (k === "*" ? 0 : k.endsWith("*") ? 1 : 2);
  return Object.keys(style)
    .filter((k) => matchesId(k, id))
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length)
    .map((k) => style[k]);
}

export function applyFigureStyle(spec: PlotSpec, style: FigureStyle | undefined, id: string | undefined): { spec: PlotSpec; exp?: FigureExport } {
  const patches = id ? patchesFor(style, id) : [];
  if (!patches.length) return { spec };
  let layout = spec.layout as Obj;
  let data = spec.data as Obj[];
  let exp: FigureExport | undefined;
  for (const p of patches) {
    if (p.layout) {
      const { xaxes, yaxes, ...rest } = p.layout as Obj;
      layout = deepMerge(layout, rest) as Obj;
      for (const [prefix, patch] of [["xaxis", xaxes], ["yaxis", yaxes]] as const) {
        if (!isObj(patch)) continue;
        const axes = Object.keys(layout).filter((k) => new RegExp(`^${prefix}\\d*$`).test(k));
        for (const k of axes.length ? axes : [prefix]) layout = { ...layout, [k]: deepMerge(layout[k], patch) };
      }
    }
    if (p.traces) {
      const rules = Object.entries(p.traces);
      data = data.map((t, i) => rules.reduce((acc, [sel, set]) => (matchesTrace(sel, t, i) ? (deepMerge(acc, set) as Obj) : acc), t));
    }
    if (p.export) exp = { ...exp, ...p.export };
  }
  return { spec: { data, layout }, exp };
}

/** Export size from a figure patch: cm -> CSS px at 96 dpi, dpi -> scale. */
export function figureExport(base: ExportOptions, e: FigureExport | undefined): ExportOptions {
  if (!e) return base;
  const cm = (v: number | undefined) => (v == null ? undefined : Math.round((v / 2.54) * 96));
  return {
    format: e.format ?? base.format,
    width: cm(e.width_cm) ?? base.width,
    height: cm(e.height_cm) ?? base.height,
    scale: e.dpi ? e.dpi / 96 : base.scale,
  };
}

/** Layout and a short trace list (no data arrays) for the assistant. */
export function figureInfo(id: string, ariaLabel: string, spec: PlotSpec): FigureInfo {
  const layout = structuredClone(spec.layout as Obj);
  return {
    id,
    title: ariaLabel,
    layout,
    traces: (spec.data as Obj[]).slice(0, 40).map((t, i) => {
      const out: Obj = { index: i };
      for (const k of ["name", "type", "mode", "xaxis", "yaxis", "legendgroup", "showlegend", "line", "marker", "opacity", "fill"])
        if (t[k] !== undefined) out[k] = t[k];
      return out;
    }),
  };
}

/** Figures each module draws (Forward also has trajectory_panel_<state>). */
export const FIGURE_IDS: Record<"forward" | "operator" | "inverse" | "mpc", string[]> = {
  forward: ["trajectories", "phase", "loss", "error"],
  operator: ["prediction", "compare", "loss"],
  inverse: ["fit", "parameter_history", "loss", "residuals"],
  mpc: ["states", "controls", "objective", "surrogate_loss"],
};

/** Provided by the App shell: the active module's figure style, and a registry of figures on screen. */
export interface FigureStyleContextValue {
  style: FigureStyle | undefined;
  register: (info: FigureInfo) => void;
  unregister: (id: string) => void;
}
export const FigureStyleContext = createContext<FigureStyleContextValue>({ style: undefined, register: () => {}, unregister: () => {} });
