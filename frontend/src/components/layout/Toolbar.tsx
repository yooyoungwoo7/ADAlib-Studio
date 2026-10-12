import { useRef } from "react";
import type { Connection, PlotStyle, ThemePref } from "../../hooks/hooks";
import type { Health } from "../../types/api";
import { Button, Icon, ICONS, StatusDot } from "../common/controls";

export function Toolbar({
  projectName,
  onRename,
  onNew,
  onOpen,
  onSave,
  running,
  canRun,
  runBlockReason,
  runLabel,
  onRun,
  onStop,
  theme,
  onTheme,
  plotStyle,
  onPlotStyle,
  conn,
  health,
  panels,
  onTogglePanel,
}: {
  projectName: string;
  onRename: (n: string) => void;
  onNew: () => void;
  onOpen: (file: File) => void;
  onSave: () => void;
  running: boolean;
  canRun: boolean;
  runBlockReason: string | null;
  runLabel: string;
  onRun: () => void;
  onStop: () => void;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  plotStyle: PlotStyle;
  onPlotStyle: (s: PlotStyle) => void;
  conn: Connection;
  health: Health | null;
  panels: { left: boolean; right: boolean; bottom: boolean };
  onTogglePanel: (p: "left" | "right" | "bottom") => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const nextTheme: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
  const themeIcon = { system: ICONS.monitor, light: ICONS.sun, dark: ICONS.moon }[theme];
  const connState = conn === "online" ? (health?.adalib_installed ? (health.adalib_version_supported ? "ok" : "warn") : "bad") : conn === "offline" ? "bad" : "idle";
  const connText =
    conn === "online"
      ? health?.adalib_installed
        ? `adalib ${health.adalib_version}${health.adalib_version_supported ? "" : " (untested version)"}`
        : "adalib not installed"
      : conn === "offline"
        ? "Backend offline"
        : "Connecting…";

  return (
    <header className="flex items-center gap-2 h-11 px-3 bg-panel border-b border-line shrink-0 min-w-0">
      <div className="flex items-center gap-2 pr-3 border-r border-line shrink-0 max-sm:border-0 max-sm:pr-0">
        <img src="/favicon.svg" alt="" width={20} height={20} />
        <div className="leading-tight">
          <div className="font-semibold text-[13.5px] max-sm:hidden">ADALib Studio</div>
          <div className="text-[10.5px] text-muted hidden md:block">Physics-Informed ODE Simulation &amp; Control</div>
        </div>
      </div>

      <input
        aria-label="Project name"
        className="field hidden sm:block w-40 lg:w-60 border-transparent bg-transparent hover:bg-panel-2 font-medium"
        value={projectName}
        onChange={(e) => onRename(e.target.value)}
      />

      <div className="flex items-center gap-0.5">
        <Button variant="ghost" onClick={onNew} title="New project">
          <Icon d={ICONS.file} /> <span className="hidden lg:inline">New</span>
        </Button>
        <Button variant="ghost" onClick={() => fileRef.current?.click()} title="Open a saved project (.json)">
          <Icon d={ICONS.open} /> <span className="hidden lg:inline">Open</span>
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onOpen(f);
            e.target.value = "";
          }}
        />
        <Button variant="ghost" onClick={onSave} title="Save project as a JSON file">
          <Icon d={ICONS.save} /> <span className="hidden lg:inline">Save</span>
        </Button>
      </div>

      <div className="flex items-center gap-1.5 ml-2">
        {running ? (
          <Button variant="danger" onClick={onStop} title="Stop: terminates the worker process">
            <Icon d={ICONS.stop} /> Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={onRun} disabled={!canRun} title={runBlockReason ?? `${runLabel} (Ctrl+Enter)`}>
            <Icon d={ICONS.play} /> {runLabel}
          </Button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <span className="hidden md:flex items-center gap-1.5 px-2 text-[12px] text-ink-2 whitespace-nowrap" title={health ? `TensorFlow ${health.dependencies.tensorflow ?? "?"}` : undefined} role="status">
          <StatusDot state={connState} /> {connText}
        </span>
        <Button variant="ghost" aria-pressed={panels.left} onClick={() => onTogglePanel("left")} title="Toggle module navigator" aria-label="Toggle module navigator">
          <Icon d={ICONS.panelLeft} />
        </Button>
        <Button variant="ghost" aria-pressed={panels.bottom} onClick={() => onTogglePanel("bottom")} title="Toggle console" aria-label="Toggle console">
          <Icon d={ICONS.panelBottom} />
        </Button>
        <Button variant="ghost" className="hidden lg:inline-flex" aria-pressed={panels.right} onClick={() => onTogglePanel("right")} title="Toggle solver configuration" aria-label="Toggle solver configuration">
          <Icon d={ICONS.panelRight} />
        </Button>
        <Button
          variant="ghost"
          onClick={() => onPlotStyle(plotStyle === "paper" ? "screen" : "paper")}
          title={plotStyle === "paper" ? "Plot style: paper figure (click for screen style)" : "Plot style: screen (click for paper figure style)"}
          aria-label={`Plot style: ${plotStyle}`}
        >
          <span className={plotStyle === "paper" ? "font-serif" : ""}>{plotStyle === "paper" ? "Paper" : "Screen"}</span>
        </Button>
        <Button variant="ghost" onClick={() => onTheme(nextTheme[theme])} title={`Theme: ${theme} (click to change)`} aria-label={`Theme: ${theme}`}>
          <Icon d={themeIcon} />
        </Button>
      </div>
    </header>
  );
}
