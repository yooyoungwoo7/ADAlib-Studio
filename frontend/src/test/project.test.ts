import { describe, expect, it } from "vitest";
import {
  blankOperator,
  blankProject,
  operatorIssues,
  operatorRequest,
  FALLBACK_FORWARD_DEFAULTS,
  forwardRequest,
  localIssues,
  parseProjectFile,
  serializeProject,
} from "../project";
import { lossPlot, trajectoryPlot } from "../plots/charts";
import type { StageRecord } from "../types/api";

const D = FALLBACK_FORWARD_DEFAULTS;

describe("project files", () => {
  it("round-trips through save/open", () => {
    const p = { ...blankProject(D), name: "LV study" };
    const back = parseProjectFile(serializeProject(p, "job-1"), D);
    expect(back.project).toEqual(p);
    expect(back.last_job_id).toBe("job-1");
  });

  it("rejects foreign or broken files", () => {
    expect(() => parseProjectFile("{", D)).toThrow(/not valid JSON/);
    expect(() => parseProjectFile('{"format":"other"}', D)).toThrow(/Not an ADALib Studio project/);
    expect(() => parseProjectFile('{"format":"adalib-studio-project","version":99,"project":{}}', D)).toThrow(/newer/);
  });

  it("migrates v1 files and fills missing options from package defaults", () => {
    const f = { format: "adalib-studio-project", version: 1, project: { system: { states: [], parameters: [], equations: [] }, options: { n_seg: 10 } } };
    const p = parseProjectFile(JSON.stringify(f), D).project;
    expect(p.forward.options.n_seg).toBe(10);
    expect(p.forward.options.Nt_total).toBe(D.Nt_total);
    expect(p.operator.options.n_train).toBeGreaterThan(0);
  });
});

describe("local checks", () => {
  it("flags grid divisibility and time order", () => {
    const p = blankProject(D).forward;
    expect(localIssues(p)).toEqual([]);
    const bad = { ...p, time: { t0: 1, t1: 1 }, options: { ...p.options, n_seg: 7, Nt_total: 100 } };
    const issues = localIssues(bad);
    expect(issues.some((m) => m.includes("t_end"))).toBe(true);
    expect(issues.some((m) => m.includes("divisible"))).toBe(true);
    expect(localIssues({ ...p, options: { ...p.options, basis: "lpa", n_seg: 7, Nt_total: 100 } })).toEqual([]);
  });

  it("trims names in the request", () => {
    const p = blankProject(D).forward;
    p.system.states[0].name = " x ";
    expect(forwardRequest(p).system.states[0].name).toBe("x");
  });
});

describe("operator project", () => {
  it("requires training ranges for custom systems", () => {
    const p = blankOperator();
    expect(operatorIssues(p)).toEqual([]);
    p.system.states[0].upper = -5;
    expect(operatorIssues(p)[0]).toMatch(/training range/);
    expect(operatorIssues({ ...p, source: "builtin" })).toEqual([]);
  });

  it("builds requests for both sources", () => {
    const p = blankOperator();
    expect(operatorRequest(p, "x").system?.controls?.[0].name).toBe("u");
    const b = operatorRequest({ ...p, source: "builtin", builtin: "cstr" }, "x");
    expect(b.system).toBeNull();
    expect(b.builtin).toBe("cstr");
  });
});

const series = ["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8"];
const tokens = { paper: false, surface: "#fff", ink: "#000", ink2: "#333", muted: "#777", grid: "#eee", axis: "#ccc", series,
  ref: "#2", pred: "#1", ctrl: "#1", cost: "#1", tgt: "#2", err: "#1" };
const paperTokens = { ...tokens, paper: true, ref: "#000" };

describe("chart builders", () => {
  it("keeps a state's color when other states are hidden", () => {
    const spec = trajectoryPlot(tokens, [0, 1], [{ name: "R", y: [1, 2], ref: [1, 2] }], ["U", "R"]);
    expect(spec.data).toHaveLength(2);
    expect((spec.data[0] as { line: { color: string } }).line.color).toBe("#2");
    expect((spec.data[1] as { line: { dash: string } }).line.dash).toBe("dash");
  });

  it("paper style: black solid reference under a dashed coloured prediction", () => {
    const spec = trajectoryPlot(paperTokens, [0, 1], [{ name: "R", y: [1, 2], ref: [1, 2] }], ["U", "R"]);
    const [ref, ada] = spec.data as { name: string; line: { color: string; dash?: string } }[];
    expect(ref.name).toBe("reference");
    expect(ref.line).toEqual({ color: "#000", width: 1.8 });
    expect(ada.line.color).toBe("#2");
    expect(ada.line.dash).toBe("dash");
    expect((spec.layout.xaxis as { ticks: string; mirror: string }).ticks).toBe("inside");
  });

  it("plots logged losses per stage", () => {
    const h: StageRecord[] = [
      { unit: "segment", index: 0, total: 2, stage: "Adam", seconds: 1, loss: 10, parts: [], message: null },
      { unit: "segment", index: 0, total: 2, stage: "L-BFGS", seconds: 1, loss: 1e-3, parts: [], message: null },
      { unit: "segment", index: 1, total: 2, stage: "Adam", seconds: 1, loss: 5, parts: [], message: null },
    ];
    const spec = lossPlot(tokens, h);
    const [adam, lbfgs] = spec.data as { x: number[]; y: number[] }[];
    expect(adam.x).toEqual([1, 2]);
    expect(adam.y).toEqual([10, 5]);
    expect(lbfgs.x).toEqual([1]);
  });
});
