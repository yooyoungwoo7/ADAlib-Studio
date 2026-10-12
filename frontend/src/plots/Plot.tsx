import { useEffect, useRef } from "react";
import type { ExportOptions } from "./style";
import type { PlotSpec } from "./theme";

// Plotly is ~4.6 MB; load it on first chart instead of with the app shell.
const loadPlotly = () => import("plotly.js-dist-min").then((m) => m.default);

export { baseLayout, chartTokens, type PlotSpec, type Tokens } from "./theme";

/** Save a rendered chart (the element passed to Plot's elementRef); size/dpi from the figure style. */
export async function downloadPlot(el: HTMLElement, filename: string, exp: ExportOptions) {
  const Plotly = await loadPlotly();
  await Plotly.downloadImage(el as HTMLElement & Parameters<typeof Plotly.downloadImage>[0], { ...exp, filename } as never);
}

export function Plot({
  spec,
  filename,
  ariaLabel,
  themeKey,
  elementRef,
  className = "w-full h-full min-h-[240px]",
  exportOptions = { format: "png", scale: 2 },
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
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    loadPlotly().then((Plotly) => {
      if (!alive) return;
      Plotly.react(el, spec.data, spec.layout, {
        responsive: true,
        displaylogo: false,
        scrollZoom: false,
        modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
        toImageButtonOptions: { ...exportOptions, filename },
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, filename, themeKey, JSON.stringify(exportOptions)]);

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
