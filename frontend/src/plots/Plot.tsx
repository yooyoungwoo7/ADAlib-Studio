import { useEffect, useRef } from "react";
import type { PlotSpec } from "./theme";

// Plotly is ~4.6 MB; load it on first chart instead of with the app shell.
const loadPlotly = () => import("plotly.js-dist-min").then((m) => m.default);

export { baseLayout, chartTokens, type PlotSpec, type Tokens } from "./theme";

/** Save a rendered chart (the element passed to Plot's elementRef) as PNG (2x) or SVG. */
export async function downloadPlot(el: HTMLElement, filename: string, format: "png" | "svg") {
  const Plotly = await loadPlotly();
  await Plotly.downloadImage(el as HTMLElement & Parameters<typeof Plotly.downloadImage>[0], { format, filename, scale: 2 });
}

export function Plot({
  spec,
  filename,
  ariaLabel,
  themeKey,
  elementRef,
  className = "w-full h-full min-h-[240px]",
}: {
  spec: PlotSpec;
  filename: string;
  ariaLabel: string;
  themeKey: string;
  /** receives the chart element, e.g. for downloadPlot */
  elementRef?: (el: HTMLDivElement | null) => void;
  className?: string;
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
        toImageButtonOptions: { format: "png", filename, scale: 2 },
      });
    });
    return () => {
      alive = false;
    };
  }, [spec, filename, themeKey]);

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
