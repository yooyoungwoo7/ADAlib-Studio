import { useEffect, useRef, useState } from "react";
import { useElapsed } from "../../hooks/hooks";
import type { JobStatus } from "../../types/api";
import { StatusDot } from "../common/controls";

const STATE_DOT = { pending: "idle", running: "warn", completed: "ok", failed: "bad", cancelled: "idle" } as const;

export function formatSeconds(s: number | null) {
  if (s === null) return "—";
  if (s < 60) return `${s.toFixed(0)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function lineClass(line: string) {
  if (/Traceback|Error|Exception/.test(line)) return "text-bad";
  if (/Warning|WARNING|ABNORMAL/.test(line)) return "text-warn";
  if (line.startsWith("[studio]")) return "text-accent";
  return "";
}

export function Console({
  status,
  log,
  pollError,
}: {
  status: JobStatus | null;
  log: string;
  pollError: string | null;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const [follow, setFollow] = useState(true);
  const active = status?.status === "running" || status?.status === "pending";
  const elapsed = useElapsed(status?.started_at, status?.ended_at, !!active);
  const p = status?.progress;

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log, follow]);

  const progressText = p
    ? p.unit === "full"
      ? `final ${p.stage}`
      : p.index == null || !p.total
        ? p.stage
        : `${p.unit} ${p.index + 1} / ${p.total} · ${p.stage}`
    : null;
  const fraction =
    p && p.total && p.index != null
      ? (p.index + (p.unit !== "segment" || p.stage === "L-BFGS" || !/L-BFGS/.test(log) ? 1 : 0.5)) / p.total
      : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-4 h-8 px-3 border-b border-line text-[12px] shrink-0 overflow-x-auto">
        <h2 className="panel-title shrink-0">Execution console</h2>
        {status ? (
          <>
            <span className="flex items-center gap-1.5 shrink-0" aria-live="polite">
              <StatusDot state={STATE_DOT[status.status]} />
              <span className="font-medium capitalize">{status.status}</span>
              <span className="text-muted font-mono">{status.id}</span>
            </span>
            <span className="text-ink-2 shrink-0">Elapsed {formatSeconds(elapsed)}</span>
            {progressText && <span className="text-ink-2 shrink-0">{progressText}</span>}
            {p?.loss != null && (
              <span className="text-ink-2 shrink-0 font-mono">loss {p.loss.toExponential(3)}</span>
            )}
            {p?.val_loss != null && (
              <span className="text-ink-2 shrink-0 font-mono">val {p.val_loss.toExponential(3)}</span>
            )}
            {fraction !== null && active && (
              <div
                className="w-32 h-1.5 rounded bg-panel-3 overflow-hidden shrink-0"
                role="progressbar"
                aria-label="Training progress (from adalib log)"
                aria-valuenow={Math.round(fraction * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full bg-accent" style={{ width: `${fraction * 100}%` }} />
              </div>
            )}
            {status.status === "running" && !p && (
              <span className="text-muted shrink-0">starting worker / importing TensorFlow…</span>
            )}
          </>
        ) : (
          <span className="text-muted">No job yet. Define a system and press Run (Ctrl+Enter).</span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-muted shrink-0 cursor-pointer">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
        </label>
      </div>
      {(status?.error || pollError) && (
        <div role="alert" className="px-3 py-1.5 text-[12px] text-bad border-b border-line shrink-0">
          {status?.error ?? pollError}
        </div>
      )}
      <pre
        ref={ref}
        tabIndex={0}
        aria-label="adalib output"
        className="flex-1 min-h-0 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-ink-2 whitespace-pre-wrap break-all"
      >
        {log
          ? log.split("\n").map((l, i) => (
              <div key={i} className={lineClass(l)}>
                {l || " "}
              </div>
            ))
          : status
            ? "Waiting for output…"
            : ""}
      </pre>
    </div>
  );
}
