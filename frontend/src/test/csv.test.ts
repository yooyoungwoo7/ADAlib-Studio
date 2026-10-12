import { describe, expect, it } from "vitest";
import { checkMapping, parseCsv } from "../services/csv";

describe("parseCsv", () => {
  it("reads headers, delimiters, quotes and missing cells", () => {
    const c = parseCsv('time;prey;"pred, total"\n0.1;0.5;0.07\n0.2;;0.08\n0.3;n/a;0.09\n');
    expect(c.delimiter).toBe(";");
    expect(c.headers).toEqual(["time", "prey", "pred, total"]);
    expect(c.rows[1]).toEqual([0.2, null, 0.08]);
    expect(c.nonNumeric).toEqual([{ row: 3, col: 1, text: "n/a" }]);
  });

  it("handles files without a header", () => {
    const c = parseCsv("0,1\n1,2\n");
    expect(c.headers).toEqual(["column 1", "column 2"]);
    expect(c.rows).toHaveLength(2);
  });

  it("rejects empty files", () => {
    expect(() => parseCsv("\n\n")).toThrow(/empty/);
  });
});

describe("checkMapping", () => {
  const csv = parseCsv("t,x,y\n0.1,1,\n0.2,2,3\n0.15,3,4\n2.0,4,5\n");
  it("reports ordering, range, missing rows and duplicates", () => {
    const c = checkMapping(csv, 0, { x: 1, y: 2 }, 0, 1);
    expect(c.errors.join(" ")).toMatch(/strictly increasing/);
    expect(c.errors.join(" ")).toMatch(/outside the time domain/);
    expect(c.notes.join(" ")).toMatch(/1 row\(s\) with missing/);
    expect(checkMapping(csv, 0, { x: 0 }, 0, 5).errors.join(" ")).toMatch(/more than once/);
    expect(checkMapping(csv, null, { x: 1 }, 0, 5).errors[0]).toMatch(/time column/);
  });
  it("accepts a clean mapping", () => {
    const ok = parseCsv("t,x\n0.1,1\n0.2,2\n");
    expect(checkMapping(ok, 0, { x: 1, y: null }, 0, 1)).toEqual({ errors: [], notes: [], usable: 2 });
  });
});
