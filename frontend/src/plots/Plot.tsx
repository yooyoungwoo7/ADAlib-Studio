import { useEffect, useRef } from "react";
import type { PlotSpec } from "./theme";

// Plotly is ~4.6 MB; load it on first chart instead of with the app shell.
const loadPlotly = () => import("plotly.js-dist-min").then((m) => m.default);

export { baseLayout, chartTokens, type PlotSpec, type Tokens } from "./theme";

export function Plot({
  spec,
  filename,
  ariaLabel,
  themeKey,
}: {
  spec: PlotSpec;
  filename: string;
  ariaLabel: string;
  themeKey: string;
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

  return <div ref={ref} role="img" aria-label={ariaLabel} className="w-full h-full min-h-[240px]" />;
}
