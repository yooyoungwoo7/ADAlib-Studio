import type { ReactNode } from "react";
import type { AssistBinding } from "../components/assist/AssistPanel";
import type { Connection, useJob } from "../hooks/hooks";
import type { Project } from "../project";
import type { Capabilities, Example, ForwardOptions, Health } from "../types/api";

/** What every module hook receives from the App shell. */
export interface ModuleContext {
  conn: Connection;
  health: Health | null;
  caps: Capabilities | null;
  forwardDefaults: ForwardOptions;
  themeKey: string;
  examples: Example[];
  project: Project;
  setProject: (fn: (p: Project) => Project) => void;
  /** the job shown in the console (any module) */
  job: ReturnType<typeof useJob>;
  jobId: string | null;
  /** submit-and-show: makes a job the console's active job */
  showJob: (id: string | null) => void;
  notify: (msg: string | null) => void;
  /** changes whenever a run is added or deleted (modules listing trained models refresh on it) */
  historyKey: string;
}

/** What a module hands back to the shell for layout. */
export interface ModuleView {
  editor: ReactNode;
  config: ReactNode | null;
  results: ReactNode;
  /** why Run is disabled, or null */
  blockReason: string | null;
  runLabel: string;
  /** submits the module's main job and returns its id */
  run: () => Promise<string>;
  onExample: (ex: Example) => void;
  /** what the AI assistant panel may change in this module */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assist: AssistBinding<any>;
}

export function backendBlock(ctx: ModuleContext): string | null {
  if (ctx.conn !== "online") return "Backend is not reachable";
  if (!ctx.health?.adalib_installed) return "adalib is not installed in the backend environment";
  return null;
}
