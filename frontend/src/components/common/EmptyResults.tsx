import type { JobStatus } from "../../types/api";

export function EmptyResults({ status, idle, running }: { status: JobStatus | null; idle: string; running: string }) {
  const msg = !status
    ? idle
    : status.status === "failed"
      ? "The run failed — see the console for adalib's output and traceback."
      : status.status === "cancelled"
        ? "The run was cancelled."
        : status.status === "completed"
          ? idle
          : running;
  return (
    <div className="h-full flex items-center justify-center p-8">
      <p className="max-w-sm text-center text-ink-2 leading-relaxed">{msg}</p>
    </div>
  );
}
