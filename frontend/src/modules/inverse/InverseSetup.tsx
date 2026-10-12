import { useRef } from "react";
import { Button, Field, Icon, ICONS, NumberField, OptionalNumberField, Section } from "../../components/common/controls";
import { inverseUnknown, type InverseProject, type InverseUnknown } from "../../project";
import { checkMapping, parseCsv } from "../../services/csv";

/** "Unknown parameters" and "Observations" sections of the Inverse editor. */
export function InverseSetup({ p, set, notify }: { p: InverseProject; set: (patch: Partial<InverseProject>) => void; notify: (m: string) => void }) {
  const params = p.system.parameters;
  const states = p.system.states.map((s) => s.name);
  const setU = (name: string, patch: Partial<InverseUnknown>) => set({ unknowns: { ...p.unknowns, [name]: { ...inverseUnknown(p, name), ...patch } } });
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File) => {
    try {
      const csv = parseCsv(await f.text());
      const lower = csv.headers.map((h) => h.trim().toLowerCase());
      const tCol = Math.max(0, lower.findIndex((h) => h === "t" || h === "time" || h.startsWith("time")));
      const stateCols: Record<string, number | null> = {};
      for (const s of states) {
        const j = lower.indexOf(s.toLowerCase());
        stateCols[s] = j >= 0 && j !== tCol ? j : null;
      }
      set({ upload: { filename: f.name, csv, tCol, stateCols }, dataSource: "upload" });
    } catch (e) {
      notify(`Could not read ${f.name}: ${(e as Error).message}`);
    }
  };

  const up = p.upload;
  const check = up ? checkMapping(up.csv, up.tCol, up.stateCols, p.time.t0, p.time.t1) : null;
  const optionalNum = (v: number | null, onChange: (v: number | null) => void, label: string) => (
    <OptionalNumberField label={label} value={v} onChange={onChange} placeholder="none" />
  );

  return (
    <>
      <Section title="Unknown parameters">
        <p className="text-[12px] text-ink-2 mb-2 leading-snug">
          Tick the parameters to estimate. The value column is used as the fixed value for the others
          {p.dataSource === "synthetic" ? " and as the true value that generates the synthetic data." : "."}
        </p>
        <div className="grid grid-cols-[22px_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-1.5 gap-y-1.5 items-center text-[12px]">
          <span />
          <span className="text-muted">Name</span>
          <span className="text-muted">Initial guess</span>
          <span className="text-muted">Lower</span>
          <span className="text-muted">Upper</span>
          {params.map((q) => {
            const u = inverseUnknown(p, q.name);
            return (
              <div key={q.name} className="contents">
                <input type="checkbox" aria-label={`Estimate ${q.name}`} checked={u.estimate} onChange={(e) => setU(q.name, { estimate: e.target.checked })} />
                <span className="font-mono truncate" title={q.name}>
                  {q.name}
                </span>
                {u.estimate ? (
                  <>
                    <NumberField label={`Initial guess for ${q.name}`} value={u.initial} onChange={(v) => setU(q.name, { initial: v })} />
                    {optionalNum(u.lower, (v) => setU(q.name, { lower: v }), `lower bound of ${q.name}`)}
                    {optionalNum(u.upper, (v) => setU(q.name, { upper: v }), `upper bound of ${q.name}`)}
                  </>
                ) : (
                  <span className="col-span-3 text-muted">fixed at {q.value}</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11.5px] text-muted leading-snug">
          Bounds are enforced by adalib's InverseParameter transform (softplus / sigmoid); leave them empty for an
          unbounded parameter.
        </p>
      </Section>

      <Section title="Observations">
        <div role="radiogroup" aria-label="Observation source" className="grid grid-cols-2 gap-1 p-0.5 bg-panel-3 rounded mb-3">
          {(["synthetic", "upload"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={p.dataSource === s}
              onClick={() => set({ dataSource: s })}
              className={`h-7 rounded text-[12.5px] cursor-pointer ${p.dataSource === s ? "bg-panel text-ink font-medium shadow-sm" : "text-ink-2 hover:text-ink"}`}
            >
              {s === "synthetic" ? "Synthetic (test)" : "Upload CSV"}
            </button>
          ))}
        </div>

        {p.dataSource === "synthetic" ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-[12px] text-ink-2 leading-snug">
              Generated from an independent scipy Radau solution with the parameter values above plus Gaussian noise —
              not from ADA, so the test is not an "inverse crime" (same approach as adalib's inverse example).
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Points" htmlFor="syn-n">
                <NumberField id="syn-n" label="Number of observations" integer min={2} value={p.synthetic.n_points} onChange={(v) => set({ synthetic: { ...p.synthetic, n_points: v } })} />
              </Field>
              <Field label="Noise (% RMS)" htmlFor="syn-noise">
                <NumberField id="syn-noise" label="Noise percent" min={0} value={p.synthetic.noise_pct} onChange={(v) => set({ synthetic: { ...p.synthetic, noise_pct: v } })} />
              </Field>
              <Field label="Seed" htmlFor="syn-seed">
                <NumberField id="syn-seed" label="Random seed" integer min={0} value={p.synthetic.seed} onChange={(v) => set({ synthetic: { ...p.synthetic, seed: v } })} />
              </Field>
            </div>
            <fieldset>
              <legend className="text-[12px] text-ink-2 mb-1">Observed states</legend>
              <div className="flex flex-wrap gap-3 text-[12.5px]">
                {states.map((s) => {
                  const all = p.synthetic.observed.length === 0;
                  const on = all || p.synthetic.observed.includes(s);
                  return (
                    <label key={s} className="flex items-center gap-1.5 cursor-pointer font-mono">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          const cur = all ? states : p.synthetic.observed;
                          const next = e.target.checked ? [...cur, s] : cur.filter((x) => x !== s);
                          if (next.length) set({ synthetic: { ...p.synthetic, observed: next.length === states.length ? [] : next } });
                        }}
                      />
                      {s}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Button onClick={() => fileRef.current?.click()}>
                <Icon d={ICONS.open} /> {up ? "Replace file" : "Choose CSV"}
              </Button>
              {up && <span className="text-[12px] font-mono truncate">{up.filename}</span>}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.tsv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            {!up && (
              <p className="text-[12px] text-ink-2 leading-snug">
                A table with a time column and one column per observed state (comma, semicolon or tab separated, header
                optional). Not every state needs to be observed.
              </p>
            )}
            {up && check && (
              <>
                <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-2 gap-y-1.5 items-center text-[12.5px]">
                  <label htmlFor="map-t" className="text-ink-2">
                    Time
                  </label>
                  <select id="map-t" className="field" value={up.tCol ?? ""} onChange={(e) => set({ upload: { ...up, tCol: e.target.value === "" ? null : Number(e.target.value) } })}>
                    <option value="">—</option>
                    {up.csv.headers.map((h, j) => (
                      <option key={j} value={j}>
                        {h}
                      </option>
                    ))}
                  </select>
                  {states.map((s) => (
                    <div key={s} className="contents">
                      <label htmlFor={`map-${s}`} className="font-mono">
                        {s}
                      </label>
                      <select
                        id={`map-${s}`}
                        className="field"
                        value={up.stateCols[s] ?? ""}
                        onChange={(e) => set({ upload: { ...up, stateCols: { ...up.stateCols, [s]: e.target.value === "" ? null : Number(e.target.value) } } })}
                      >
                        <option value="">not observed</option>
                        {up.csv.headers.map((h, j) => (
                          <option key={j} value={j}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="text-[12px] text-ink-2">{check.usable} usable row(s) of {up.csv.rows.length}.</p>
                {check.errors.map((m) => (
                  <p key={m} role="alert" className="text-[12px] text-bad">
                    {m}
                  </p>
                ))}
                {check.notes.map((m) => (
                  <p key={m} className="text-[12px] text-warn">
                    {m}
                  </p>
                ))}
                <label className="flex items-start gap-2 text-[12.5px] cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={p.compareToValues} onChange={(e) => set({ compareToValues: e.target.checked })} />
                  <span>
                    The parameter values above are known true values
                    <span className="block text-[11.5px] text-muted">Report the estimation error against them.</span>
                  </span>
                </label>
              </>
            )}
          </div>
        )}
      </Section>
    </>
  );
}

export function uploadBlock(p: InverseProject): string | null {
  if (p.dataSource !== "upload") return null;
  if (!p.upload) return "Upload an observation file (CSV).";
  const c = checkMapping(p.upload.csv, p.upload.tCol, p.upload.stateCols, p.time.t0, p.time.t1);
  return c.errors[0] ?? null;
}
