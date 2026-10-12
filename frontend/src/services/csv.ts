// Small, dependency-free CSV reader for observation files: comma, semicolon or
// tab separated, optional header row, quoted fields, empty cells = missing.

export interface ParsedCsv {
  headers: string[];
  rows: (number | null)[][];
  /** cells that were present but not numeric (row, column, text) */
  nonNumeric: { row: number; col: number; text: string }[];
  delimiter: string;
}

function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

export function parseCsv(text: string): ParsedCsv {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  if (!lines.length) throw new Error("The file is empty.");
  const first = lines[0];
  const delimiter = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const cells = lines.map((l) => splitLine(l, delimiter));
  const hasHeader = cells[0].some((c) => c !== "" && !NUM.test(c));
  const width = Math.max(...cells.map((r) => r.length));
  const headers = hasHeader ? cells[0].map((h, i) => h || `column ${i + 1}`) : Array.from({ length: width }, (_, i) => `column ${i + 1}`);
  while (headers.length < width) headers.push(`column ${headers.length + 1}`);
  const body = hasHeader ? cells.slice(1) : cells;
  const nonNumeric: ParsedCsv["nonNumeric"] = [];
  const rows = body.map((r, i) =>
    headers.map((_, j) => {
      const c = r[j] ?? "";
      if (c === "" || /^(nan|na|null)$/i.test(c)) return null;
      if (!NUM.test(c)) {
        nonNumeric.push({ row: i + 1, col: j, text: c });
        return null;
      }
      return Number(c);
    }),
  );
  if (!rows.length) throw new Error("The file has a header but no data rows.");
  return { headers, rows, nonNumeric, delimiter };
}

export interface MappingCheck {
  errors: string[];
  notes: string[];
  usable: number;
}

/** The same checks the backend applies, shown before submitting. */
export function checkMapping(csv: ParsedCsv, tCol: number | null, stateCols: Record<string, number | null>, t0: number, t1: number): MappingCheck {
  const errors: string[] = [];
  const notes: string[] = [];
  if (tCol == null) return { errors: ["Choose the time column."], notes, usable: 0 };
  const cols = Object.entries(stateCols).filter(([, c]) => c != null) as [string, number][];
  if (!cols.length) errors.push("Map at least one column to a state variable.");
  const used = [tCol, ...cols.map(([, c]) => c)];
  if (new Set(used).size !== used.length) errors.push("A column is mapped more than once.");
  const bad = csv.nonNumeric.filter((n) => used.includes(n.col));
  if (bad.length) notes.push(`${bad.length} non-numeric cell(s) (e.g. row ${bad[0].row}: "${bad[0].text}") are treated as missing.`);
  const complete = csv.rows.filter((r) => r[tCol] != null && cols.every(([, c]) => r[c] != null));
  const dropped = csv.rows.length - complete.length;
  if (dropped) notes.push(`${dropped} row(s) with missing values will be dropped.`);
  const ts = complete.map((r) => r[tCol] as number);
  if (ts.some((v, i) => i > 0 && v <= ts[i - 1])) errors.push("Time values must be strictly increasing (sort the file and remove duplicates).");
  const outside = ts.filter((v) => v < t0 || v > t1).length;
  if (outside) errors.push(`${outside} time value(s) lie outside the time domain [${t0}, ${t1}].`);
  if (complete.length < 2) errors.push("Fewer than 2 complete rows.");
  return { errors, notes, usable: complete.length };
}
