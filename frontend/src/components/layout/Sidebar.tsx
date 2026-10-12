import { useEffect, useState } from "react";
import type { Capabilities, Example, JobKind, JobStatus, ModuleId } from "../../types/api";
import { StatusDot } from "../common/controls";

const MODULES: { id: ModuleId; label: string; glyph: string }[] = [
  { id: "forward", label: "Forward Solver", glyph: "M2 12c3-8 6-8 8-3s4 5 6-1" },
  { id: "operator", label: "Operator Learning", glyph: "M2 4h5v8H2zM9 4h5v8H9zM7 8h2" },
  { id: "inverse", label: "Inverse Solver", glyph: "M3 12 7 4l4 8M5 9h4M12 3v10" },
  { id: "mpc", label: "Model Predictive Control", glyph: "M2 12h3l2-6 2 8 2-4h3" },
];

/** The module a job belongs to. */
export const MODULE_OF: Record<JobKind, ModuleId> = {
  forward: "forward",
  operator_train: "operator",
  operator_infer: "operator",
  inverse: "inverse",
  mpc: "mpc",
  mpc_train: "mpc",
};

// run history order, remembered per browser
const HISTORY_KEY = "adalib-studio-history-grouping";
type Grouping = "time" | "module";
function savedGrouping(): Grouping {
  try {
    return localStorage.getItem(HISTORY_KEY) === "module" ? "module" : "time";
  } catch {
    return "time";
  }
}

const DOT = { pending: "idle", running: "warn", completed: "ok", failed: "bad", cancelled: "idle" } as const;

export function Sidebar({
  module,
  onModule,
  caps,
  examples,
  activeExample,
  onExample,
  jobs,
  activeJob,
  onJob,
  onDeleteJob,
}: {
  module: ModuleId;
  onModule: (m: ModuleId) => void;
  caps: Capabilities | null;
  examples: Example[];
  activeExample: string | null;
  onExample: (e: Example) => void;
  jobs: JobStatus[];
  activeJob: string | null;
  onJob: (id: string) => void;
  onDeleteJob: (job: JobStatus) => void;
}) {
  const [grouping, setGrouping] = useState<Grouping>(savedGrouping);
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, grouping);
    } catch {
      /* not remembered */
    }
  }, [grouping]);
  const groups: { id: string; label: string | null; jobs: JobStatus[] }[] =
    grouping === "time"
      ? [{ id: "all", label: null, jobs }]
      : MODULES.map((m) => ({ id: m.id, label: m.label, jobs: jobs.filter((j) => (MODULE_OF[j.kind] ?? "forward") === m.id) })).filter((g) => g.jobs.length);

  const item = (j: JobStatus) => {
    const busy = j.status === "running" || j.status === "pending";
    return (
      <li key={j.id} className="group relative">
        <button
          type="button"
          onClick={() => onJob(j.id)}
          aria-current={activeJob === j.id ? "true" : undefined}
          className={`w-full text-left pl-2 pr-6 py-1 rounded text-[12px] cursor-pointer ${
            activeJob === j.id ? "bg-panel-3 text-ink" : "text-ink-2 hover:bg-panel-3 hover:text-ink"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <StatusDot state={DOT[j.status]} />
            <span className="truncate flex-1">{j.label || j.kind}</span>
            <span className="text-[10.5px] text-muted capitalize">{j.status}</span>
          </span>
          <span className="block pl-3.5 text-[10.5px] text-muted font-mono">{new Date(j.created_at).toLocaleString()}</span>
        </button>
        <button
          type="button"
          aria-label={`Delete run ${j.label || j.kind} (${j.id})`}
          title={busy ? "Stop the run before deleting it" : "Delete this run"}
          disabled={busy}
          onClick={() => onDeleteJob(j)}
          className="absolute right-1 top-1 w-4 h-4 flex items-center justify-center rounded text-[13px] leading-none text-muted cursor-pointer hover:text-bad hover:bg-panel-2 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ×
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="Workspace" className="flex flex-col h-full min-h-0 overflow-y-auto">
      <div className="px-3 pt-3 pb-1.5 panel-title">Modules</div>
      <ul className="px-1.5 flex flex-col gap-0.5">
        {MODULES.map((m) => {
          const status = caps?.modules[m.id]?.status;
          const available = status === "available";
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-current={module === m.id ? "page" : undefined}
                onClick={() => onModule(m.id)}
                className={`w-full flex items-center gap-2 h-8 px-2 rounded text-left text-[12.5px] cursor-pointer ${
                  module === m.id ? "bg-accent-soft/60 text-ink font-medium" : "text-ink-2 hover:bg-panel-3 hover:text-ink"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d={m.glyph} />
                </svg>
                <span className="flex-1 truncate">{m.label}</span>
                {!available && <span className="text-[10.5px] text-muted border border-line rounded px-1">planned</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {module === "forward" && (
        <>
          <div className="px-3 pt-4 pb-1.5 panel-title">Examples</div>
          <ul className="px-1.5 flex flex-col gap-0.5">
            {examples.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onExample(e)}
                  title={`${e.description}\nSource: ${e.source}`}
                  className={`w-full text-left px-2 py-1.5 rounded text-[12.5px] cursor-pointer ${
                    activeExample === e.id ? "bg-panel-3 text-ink" : "text-ink-2 hover:bg-panel-3 hover:text-ink"
                  }`}
                >
                  {e.title}
                  <span className="block text-[11px] text-muted">
                    {e.system.states.length} states · {e.studio_choices.length ? "partly studio-chosen values" : "values from adalib"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex items-center justify-between px-3 pt-4 pb-1.5">
        <span className="panel-title">Run history</span>
        {jobs.length > 0 && (
          <span role="group" aria-label="Order the run history" className="flex rounded border border-line overflow-hidden text-[10.5px]">
            {(["time", "module"] as const).map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={grouping === g}
                onClick={() => setGrouping(g)}
                className={`px-1.5 py-0.5 cursor-pointer ${grouping === g ? "bg-panel-3 text-ink" : "text-muted hover:text-ink"}`}
              >
                {g === "time" ? "Time" : "By module"}
              </button>
            ))}
          </span>
        )}
      </div>
      {jobs.length === 0 ? (
        <p className="px-3 text-[12px] text-muted">No runs yet.</p>
      ) : (
        groups.map((g) => (
          <div key={g.id}>
            {g.label && (
              <div className="px-3 pt-1.5 pb-0.5 text-[10.5px] text-muted uppercase tracking-wide">
                {g.label} <span className="normal-case">({g.jobs.length})</span>
              </div>
            )}
            <ul className="px-1.5 pb-2 flex flex-col gap-0.5">{g.jobs.map(item)}</ul>
          </div>
        ))
      )}
    </nav>
  );
}
