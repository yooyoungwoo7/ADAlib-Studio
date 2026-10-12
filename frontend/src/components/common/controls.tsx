import katex from "katex";
import { useEffect, useId, useMemo, useState, type ReactNode, type ButtonHTMLAttributes } from "react";

/** Numeric input that keeps the raw text while typing (e.g. "1e-", "-") and
 *  only commits finite numbers. */
export function NumberField({
  value,
  onChange,
  integer = false,
  min,
  label,
  id,
  className = "",
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  integer?: boolean;
  min?: number;
  label: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
  }, [value, focused]);
  const parsed = parseNum(text, integer);
  const invalid = parsed === null || (min !== undefined && parsed < min);
  return (
    <input
      id={id}
      aria-label={label}
      className={`field mono ${className}`}
      inputMode={integer ? "numeric" : "decimal"}
      value={text}
      disabled={disabled}
      aria-invalid={invalid}
      title={invalid ? (integer ? "Enter an integer" : "Enter a number") + (min !== undefined ? ` ≥ ${min}` : "") : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (!invalid) setText(fmt(parsed!));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseNum(e.target.value, integer);
        if (v !== null && (min === undefined || v >= min)) onChange(v);
      }}
    />
  );
}

function fmt(v: number) {
  return Number.isFinite(v) ? String(v) : "";
}

function parseNum(s: string, integer: boolean): number | null {
  const t = s.trim();
  if (!t || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  if (integer && !Number.isInteger(v)) return null;
  return v;
}

/** Number or "none": an empty field is valid and means null (e.g. no bound). */
export function OptionalNumberField({ value, onChange, label, placeholder = "none" }: { value: number | null; onChange: (v: number | null) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState(value == null ? "" : fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value == null ? "" : fmt(value));
  }, [value, focused]);
  const parsed = text.trim() === "" ? null : parseNum(text, false);
  const invalid = text.trim() !== "" && parsed === null;
  return (
    <input
      aria-label={label}
      className="field mono"
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      aria-invalid={invalid}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        if (t === "") onChange(null);
        else {
          const v = parseNum(t, false);
          if (v !== null) onChange(v);
        }
      }}
    />
  );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12px] text-ink-2" title={hint}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function Button({
  variant = "default",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger" }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded text-[12.5px] font-medium select-none " +
    "disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap";
  const styles = {
    default: "border border-line-strong bg-panel text-ink hover:bg-panel-2",
    primary: "bg-accent text-on-accent hover:bg-accent-hover",
    ghost: "text-ink-2 hover:bg-panel-3 hover:text-ink",
    danger: "border border-line-strong bg-panel text-bad hover:bg-panel-2",
  }[variant];
  return <button type="button" className={`${base} ${styles} ${className}`} {...rest} />;
}

export function Section({
  title,
  actions,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="border-b border-line">
      <div className="flex items-center justify-between h-8 px-3">
        {collapsible ? (
          <button
            type="button"
            className="panel-title flex items-center gap-1 cursor-pointer hover:text-ink"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            <Chevron open={open} />
            {title}
          </button>
        ) : (
          <h2 className="panel-title">{title}</h2>
        )}
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      {open && (
        <div id={id} className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={open ? "rotate-90" : ""}>
      <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Tex({ tex, block = false, className = "" }: { tex: string; block?: boolean; className?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: false, displayMode: block });
    } catch {
      return tex;
    }
  }, [tex, block]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function StatusDot({ state }: { state: "ok" | "warn" | "bad" | "idle" }) {
  const color = { ok: "var(--good)", warn: "var(--warning)", bad: "var(--critical)", idle: "var(--muted)" }[state];
  return <span aria-hidden className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />;
}

export function Icon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  play: "M4.5 3v10l8-5z",
  stop: "M4 4h8v8H4z",
  plus: "M8 3v10M3 8h10",
  x: "M4 4l8 8M12 4l-8 8",
  file: "M4 1.5h5l3 3v10H4zM9 1.5v3h3",
  open: "M1.5 4.5v8h11l2-6h-11l-2 6M1.5 4.5v-2h4l1.5 1.5h5v2",
  save: "M2.5 2.5h9l2 2v9h-11zM5 2.5v3.5h5V2.5M5 13.5V9h6v4.5",
  sun: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1",
  moon: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z",
  monitor: "M1.5 2.5h13v8h-13zM5.5 13.5h5M8 10.5v3",
  panelLeft: "M1.5 2.5h13v11h-13zM5.5 2.5v11",
  panelRight: "M1.5 2.5h13v11h-13zM10.5 2.5v11",
  panelBottom: "M1.5 2.5h13v11h-13zM1.5 10h13",
  download: "M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11",
  restore: "M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2v3h3",
};
