import { describe, expect, it } from "vitest";
import { applyFigureStyle, figureExport } from "../plots/figureStyle";

const spec = {
  data: [
    { name: "#1 operator", yaxis: "y", line: { color: "blue", width: 1 } },
    { name: "#1 operator", yaxis: "y2", line: { color: "blue", width: 1 } },
  ],
  layout: {
    xaxis: { ticks: "inside", minor: { ticks: "inside" } },
    yaxis: { ticks: "inside", minor: { ticks: "inside" } },
    yaxis2: { ticks: "inside", minor: { ticks: "inside" }, title: { text: "omega" } },
    legend: { orientation: "v" },
  },
};

describe("applyFigureStyle", () => {
  it("merges layout, reaches every axis, picks traces and keeps the original", () => {
    const { spec: out, exp } = applyFigureStyle(
      spec,
      {
        "*": { layout: { yaxes: { minor: { ticks: "" } } } },
        prediction: {
          layout: { legend: { orientation: "h", y: -0.2 } },
          traces: { "axis:y2": { line: { color: "red" } } },
          export: { width_cm: 8, dpi: 600 },
        },
        other: { layout: { title: { text: "not me" } } },
      },
      "prediction",
    );
    const L = out.layout as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(L.yaxis.minor.ticks).toBe("");
    expect(L.yaxis2.minor.ticks).toBe("");
    expect(L.yaxis2.title.text).toBe("omega");
    expect(L.xaxis.minor.ticks).toBe("inside");
    expect(L.legend).toEqual({ orientation: "h", y: -0.2 });
    expect(L.title).toBeUndefined();
    const D = out.data as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(D[0].line).toEqual({ color: "blue", width: 1 });
    expect(D[1].line).toEqual({ color: "red", width: 1 });
    expect((spec.layout.yaxis.minor as { ticks: string }).ticks).toBe("inside");
    expect(figureExport({ format: "png", scale: 2 }, exp)).toEqual({ format: "png", width: 302, height: undefined, scale: 6.25 });
  });

  it("leaves figures without a matching patch alone", () => {
    expect(applyFigureStyle(spec, { loss: { layout: { title: { text: "x" } } } }, "prediction").spec).toBe(spec);
    expect(applyFigureStyle(spec, undefined, "prediction").spec).toBe(spec);
  });
});

describe("placeholders", () => {
  it("fill {system} and {state} when drawn, and make room for a title", async () => {
    const { fillPlaceholders } = await import("../plots/figureStyle");
    const { spec: out } = applyFigureStyle(spec, { "*": { layout: { title: { text: "{system} — {state}" } } } }, "trajectory_panel_x");
    expect((out.layout as Record<string, any>).margin.t).toBe(60); // eslint-disable-line @typescript-eslint/no-explicit-any
    const a = fillPlaceholders(out, { system: "lorenz", state: "x" });
    const b = fillPlaceholders(out, { system: "duffing", state: "x" });
    expect((a.layout as Record<string, any>).title.text).toBe("lorenz — x"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((b.layout as Record<string, any>).title.text).toBe("duffing — x"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((fillPlaceholders(out, {}).layout as Record<string, any>).title.text).toBe("{system} — {state}"); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});
