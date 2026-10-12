import { useContext, useEffect, useMemo, useRef } from "react";
import { applyFigureStyle, figureExport, figureInfo, FigureStyleContext, fillPlaceholders } from "./figureStyle";
import type { ExportOptions } from "./style";
import type { PlotSpec } from "./theme";

// Plotly is ~4.6 MB; load it on first chart instead of with the app shell.
const loadPlotly = () => import("plotly.js-dist-min").then((m) => m.default);

export { baseLayout, chartTokens, type PlotSpec, type Tokens } from "./theme";

type PlotElement = HTMLElement & { studioExport?: ExportOptions };

/** Save a rendered chart (the element passed to Plot's elementRef); size/dpi from the figure style
 *  (an AI figure patch's export settings on that chart win over `exp`). */
export async function downloadPlot(el: HTMLElement, filename: string, exp: ExportOptions) {
  const Plotly = await loadPlotly();
  const own = (el as PlotElement).studioExport;
  await Plotly.downloadImage(el as HTMLElement & Parameters<typeof Plotly.downloadImage>[0], { ...(own ?? exp), filename } as never);
}

export function Plot({
  spec,
  filename,
  ariaLabel,
  themeKey,
  elementRef,
  className = "w-full h-full min-h-[240px]",
  exportOptions = { format: "png", scale: 2 },
  figureId,
}: {
  spec: PlotSpec;
  filename: string;
  ariaLabel: string;
  themeKey: string;
  /** receives the chart element, e.g. for downloadPlot */
  elementRef?: (el: HTMLDivElement | null) => void;
  className?: string;
  /** what the camera button saves */
  exportOptions?: ExportOptions;
  /** stable id ("trajectories", "loss", ...) the AI assistant's figure style refers to */
  figureId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fig = useContext(FigureStyleContext);
  const styled = useMemo(() => {
    const out = applyFigureStyle(spec, fig.style, figureId, fig.vars.system);
    const state = figureId?.startsWith("trajectory_panel_") ? figureId.slice("trajectory_panel_".length) : undefined;
    return { ...out, spec: fillPlaceholders(out.spec, { ...fig.vars, ...(state ? { state } : {}) }) };
  }, [spec, fig.style, fig.vars, figureId]);
  const exp = figureExport(exportOptions, styled.exp);

  // tell the assistant what this figure looks like before its patch
  const { register, unregister } = fig;
  useEffect(() => {
    if (!figureId) return;
    register(figureInfo(figureId, ariaLabel, spec));
  }, [figureId, ariaLabel, spec, register]);
  useEffect(() => (figureId ? () => unregister(figureId) : undefined), [figureId, unregister]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    loadPlotly().then((Plotly) => {
      if (!alive) return;
      (el as PlotElement).studioExport = styled.exp ? exp : undefined;
      Plotly.react(el, styled.spec.data, styled.spec.layout, {
        responsive: true,
        displaylogo: false,
        scrollZoom: false,
        modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
        toImageButtonOptions: { ...exp, filename },
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styled, filename, themeKey, JSON.stringify(exp)]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => loadPlotly().then((Plotly) => el.isConnected && Plotly.Plots.resize(el)));
    ro.observe(el);
    return () => {
      ro.disconnect();
      loadPlotly().then((Plotly) => Plotly.purge(el));
    };
  }, []);

  return (
    <div
      ref={(el) => {
        ref.current = el;
        elementRef?.(el);
      }}
      role="img"
      aria-label={ariaLabel}
      className={className}
    />
  );
}
