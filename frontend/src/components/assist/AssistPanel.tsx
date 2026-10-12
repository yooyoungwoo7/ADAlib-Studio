import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { api } from "../../services/api";
import type { FigureInfo } from "../../plots/figureStyle";
import type { AssistImage, AssistMessage, AssistProvider, AssistStatus } from "../../types/api";
import { Button, Field } from "../common/controls";

const MAX_IMAGES = 3;
const MAX_SIDE = 1600; // px; larger pictures are scaled down before sending

/** An attached picture: what is sent (base64) plus a data URL for the thumbnail. */
interface Attachment extends AssistImage {
  url: string;
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the image."));
    img.src = url;
  });

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });

/** File -> PNG/JPEG/WebP/GIF attachment, scaled to at most MAX_SIDE px (re-encoded as PNG when scaled). */
async function toAttachment(file: File): Promise<Attachment> {
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const supported = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
  let url = original;
  if (scale < 1 || !supported) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    url = canvas.toDataURL("image/png");
  }
  const [head, data] = url.split(",", 2);
  const media_type = head.slice(5, head.indexOf(";")) as AssistImage["media_type"];
  return { media_type, data, url };
}

/** What a module sends with a request; the answer is the module's state after the change. */
export interface AssistAsk<S> {
  prompt: string;
  images: AssistImage[];
  state: S;
  history: AssistMessage[];
  language: string;
  /** figures on screen and every figure id of the module (added by the App shell) */
  figures?: FigureInfo[];
  figure_ids?: string[];
  /** the problem whose figures are on screen ("@<system>" in a figure style) */
  figure_system?: string;
}
export interface AssistAnswer<S> {
  state: S;
  reply: string;
  model: string;
  attempts: number;
}

/**
 * How a module plugs into the assistant: the part of its setup the assistant may change (`state`,
 * a plain object whose top-level keys are what the meta line reports), how to ask, and how an
 * answer (or an undo) is put back.
 */
export interface AssistBinding<S extends object = Record<string, unknown>> {
  label: string;
  state: S;
  ask: (req: AssistAsk<S>) => Promise<AssistAnswer<S>>;
  apply: (s: S) => void;
  examples: string[];
  intro: string;
  placeholder: string;
  /** names shown in the meta line for some keys ("plotStyle" -> "figure") */
  keyLabels?: Record<string, string>;
}

/** Key-order independent JSON, so {a, b} and {b, a} compare equal. Unset values (null, [], {}) are left out. */
const empty = (v: unknown) => v == null || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);
export const canon = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v as object)
        .filter((k) => !empty((v as Record<string, unknown>)[k]))
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
        .join(",")}}`
    : Array.isArray(v)
      ? `[${v.map(canon).join(",")}]`
      : JSON.stringify(v ?? null);

const same = (a: object, b: object) => canon(a) === canon(b);
const short = (v: unknown) => (v == null ? "–" : typeof v === "object" ? "…" : String(v));

/** "tank (states h) · t ∈ [0, 10] · options: n_seg 50→100 · targets, controllers" */
function describe(a: Record<string, unknown>, b: Record<string, unknown>, labels: Record<string, string> = {}) {
  const parts: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k];
    const y = b[k];
    if (canon(x) === canon(y)) continue;
    const name = labels[k] ?? k;
    if (k === "system" && y && typeof y === "object") {
      const s = y as { name: string; states: { name: string }[] };
      parts.push(`${s.name} (states ${s.states.map((st) => st.name).join(", ")})`);
    } else if (k === "time" && y && typeof y === "object") {
      const t = y as { t0: number; t1: number };
      parts.push(`t ∈ [${t.t0}, ${t.t1}]`);
    } else if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(y)) {
      const xo = x as Record<string, unknown>;
      const yo = y as Record<string, unknown>;
      // keys the new value has (entries of a replaced system's old parameters are not news)
      const keys = Object.keys(yo).filter((q) => canon(xo[q]) !== canon(yo[q]));
      const flat = keys.every((q) => (xo[q] == null || typeof xo[q] !== "object") && (yo[q] == null || typeof yo[q] !== "object"));
      if (!keys.length) parts.push(`${name} cleared`);
      else parts.push(`${name}: ${flat ? keys.map((q) => `${q} ${short(xo[q])}→${short(yo[q])}`).join(", ") : keys.join(", ")}`);
    } else if (Array.isArray(y) || (y != null && typeof y === "object")) {
      parts.push(`${name}: ${Array.isArray(y) ? y.join(", ") : "changed"}`);
    } else parts.push(`${name} ${short(x)}→${short(y)}`);
  }
  return parts.join(" · ");
}

/** One chat line. Assistant lines that changed the module keep what was there before, for Undo. */
export interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  meta?: string;
  before?: object;
  after?: object;
  images?: string[]; // thumbnails of what the user attached
}

/**
 * The AI assistant panel (right column, below the module's settings). The backend asks the
 * configured LLM, checks the answer like a run request, and the result fills the module's panels.
 * Nothing runs until the user presses Run (or Train).
 */
export function AssistPanel({
  binding,
  chat,
  setChat,
  disabled,
  collapsed,
  onCollapse,
}: {
  binding: AssistBinding<object> | null;
  chat: ChatEntry[];
  setChat: (update: (c: ChatEntry[]) => ChatEntry[]) => void;
  disabled: boolean;
  collapsed: boolean;
  onCollapse: (c: boolean) => void;
}) {
  const [status, setStatus] = useState<AssistStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (disabled) return;
    api.assistStatus().then(setStatus).catch(() => setStatus(null));
  }, [disabled]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat, busy, collapsed]);

  const ready = !!status?.provider && !!binding;
  const addFiles = async (files: Iterable<File>) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    try {
      const added = await Promise.all(images.map(toAttachment));
      setAttachments((a) => [...a, ...added].slice(0, MAX_IMAGES));
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", content: (e as Error).message, error: true }]);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const send = async (text = prompt.trim()) => {
    if ((!text && !attachments.length) || busy || !ready || !binding) return;
    const images = attachments;
    setPrompt("");
    setAttachments([]);
    setBusy(true);
    const history = chat.filter((m) => !m.error).slice(-10).map(({ role, content, images: imgs }) => ({
      role,
      content: imgs?.length ? `${content || "(image)"} [${imgs.length} image(s) attached]` : content,
    }));
    setChat((c) => [...c, { role: "user", content: text, images: images.map((im) => im.url) }]);
    const before = binding.state;
    try {
      const r = await binding.ask({
        prompt: text,
        images: images.map(({ media_type, data }) => ({ media_type, data })),
        state: before,
        history,
        language: navigator.language,
      });
      const changed = !same(before, r.state);
      if (changed) binding.apply(r.state);
      const what = describe(before as Record<string, unknown>, r.state as Record<string, unknown>, binding.keyLabels);
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          content: r.reply || "Done.",
          meta: `${changed ? what || "updated" : "no change"} · ${r.model}${r.attempts > 1 ? ` · ${r.attempts} tries` : ""}`,
          before: changed ? before : undefined,
          after: changed ? r.state : undefined,
        },
      ]);
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const undo = (i: number) => {
    const b = chat[i].before;
    if (!b || !binding) return;
    binding.apply(b);
    setChat((c) => c.map((m, j) => (j === i ? { ...m, before: undefined, meta: `${m.meta ?? ""} · undone` } : m)));
  };

  const info = status?.provider ? status.providers[status.provider] : null;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 h-8 px-3 shrink-0 border-b border-line">
        <button
          type="button"
          className="panel-title flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer hover:text-ink"
          aria-expanded={!collapsed}
          onClick={() => onCollapse(!collapsed)}
          title={collapsed ? "Show the assistant" : "Hide the assistant"}
        >
          <span aria-hidden className="inline-block w-3 text-center">{collapsed ? "▸" : "▾"}</span>
          AI assistant
        </button>
        <span className="flex-1 min-w-0 text-[11px] text-muted truncate" title={binding?.label}>{binding ? `· ${binding.label}` : ""}</span>
        {!collapsed && (
          <Button variant="ghost" className="h-6 px-1.5 text-[11.5px]" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>
            {showSettings ? "Close settings" : "Settings"}
          </Button>
        )}
      </div>
      {!collapsed && (
        <div
          className={`flex flex-col gap-2 flex-1 min-h-0 px-3 py-2 ${dragging ? "outline-2 outline-dashed outline-accent -outline-offset-4" : ""}`}
          onDragOver={(e) => {
            if (ready && [...e.dataTransfer.types].includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {(showSettings || (status && !status.provider)) && (
            <div className="shrink-0 max-h-[60%] overflow-y-auto">
              <AssistSettings status={status} onStatus={setStatus} />
            </div>
          )}
          {status === null && !showSettings && <p className="text-[12px] text-muted">Assistant unavailable (backend offline).</p>}
          {ready && binding && (
            <>
              <div ref={listRef} className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto" aria-live="polite">
                {chat.length === 0 && (
                  <>
                    <p className="text-[11.5px] text-muted leading-snug">{binding.intro}</p>
                    <div className="flex flex-col gap-1">
                      {binding.examples.map((x) => (
                        <button
                          key={x}
                          type="button"
                          className="text-left text-[12px] text-ink-2 border border-line rounded px-2 py-1 hover:bg-panel-2 cursor-pointer"
                          onClick={() => send(x)}
                          disabled={busy}
                        >
                          {x}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {chat.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded px-2 py-1.5 text-[12.5px] leading-snug whitespace-pre-wrap ${
                      m.role === "user" ? "bg-accent-soft text-ink self-end max-w-[90%]" : m.error ? "border border-line text-bad" : "border border-line text-ink"
                    }`}
                  >
                    {m.images && m.images.length > 0 && (
                      <span className="flex flex-wrap gap-1 mb-1">
                        {m.images.map((u, k) => (
                          <img key={k} src={u} alt={`attached image ${k + 1}`} className="max-h-24 max-w-full rounded border border-line bg-white" />
                        ))}
                      </span>
                    )}
                    {m.content}
                    {m.meta && <span className="block mt-1 text-[11px] text-muted font-mono break-words">{m.meta}</span>}
                    <span className="flex gap-3">
                      {m.before && (
                        <button type="button" className="mt-1 text-[11.5px] text-ink-2 underline cursor-pointer hover:text-ink" onClick={() => undo(i)}>
                          Undo this change
                        </button>
                      )}
                      {m.after && !same(m.after, binding.state) && (
                        <button
                          type="button"
                          className="mt-1 text-[11.5px] text-ink-2 underline cursor-pointer hover:text-ink"
                          title="The panels no longer show this answer"
                          onClick={() => binding.apply(m.after!)}
                        >
                          Apply again
                        </button>
                      )}
                    </span>
                  </div>
                ))}
                {busy && <p className="text-[12px] text-muted">Thinking…</p>}
              </div>
              <label htmlFor="assist-prompt" className="sr-only">
                Ask the assistant
              </label>
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 shrink-0" aria-label="Attached images">
                  {attachments.map((a, i) => (
                    <span key={i} className="relative">
                      <img src={a.url} alt={`attachment ${i + 1}`} className="h-14 max-w-[120px] object-contain rounded border border-line bg-white" />
                      <button
                        type="button"
                        aria-label={`Remove attachment ${i + 1}`}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-panel border border-line-strong text-[10px] leading-none cursor-pointer hover:bg-panel-3"
                        onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                id="assist-prompt"
                className="field shrink-0 min-h-[64px] resize-y text-[12.5px] leading-snug py-1.5"
                placeholder={binding.placeholder}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onKey}
                onPaste={onPaste}
                disabled={busy}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className="flex items-center justify-between gap-2 shrink-0">
                <span className="text-[11px] text-muted truncate" title={info?.model}>
                  {info?.label} · {info?.model}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    title="Attach an image of the equations (or paste / drop it)"
                    aria-label="Attach image"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy || attachments.length >= MAX_IMAGES}
                  >
                    📎
                  </Button>
                  {chat.length > 0 && (
                    <Button variant="ghost" onClick={() => setChat(() => [])} disabled={busy}>
                      Clear
                    </Button>
                  )}
                  <Button variant="primary" onClick={() => send()} disabled={busy || (!prompt.trim() && !attachments.length)}>
                    Send
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AssistSettings({ status, onStatus }: { status: AssistStatus | null; onStatus: (s: AssistStatus) => void }) {
  const [provider, setProvider] = useState<AssistProvider>(status?.provider ?? "anthropic");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const info = status?.providers[provider];
  useEffect(() => {
    setModel(info?.model && info.model !== info.default_model ? info.model : "");
    setKey("");
    setMsg(null);
  }, [provider, info?.model, info?.default_model]);

  const save = async (removeKey = false) => {
    try {
      const s = await api.assistSettings({ provider, api_key: removeKey ? "" : key.trim() || undefined, model, make_default: true });
      onStatus(s);
      setKey("");
      setMsg(removeKey ? "Key removed." : "Saved.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-2 mb-1">
      {status && !status.provider && (
        <p className="text-[12px] text-ink-2 leading-snug">
          Add an Anthropic or OpenAI API key to set up any module in words. Each request is billed to that key.
        </p>
      )}
      <Field label="Provider" htmlFor="assist-provider">
        <select id="assist-provider" className="field" value={provider} onChange={(e) => setProvider(e.target.value as AssistProvider)}>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
        </select>
      </Field>
      <Field label="API key" htmlFor="assist-key">
        <input
          id="assist-key"
          type="password"
          autoComplete="off"
          className="field mono"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={info?.source === "env"}
          placeholder={
            info?.source === "env"
              ? `from ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}`
              : info?.configured
                ? `saved ${info.key_hint ?? ""} (paste to replace)`
                : provider === "anthropic"
                  ? "sk-ant-…"
                  : "sk-…"
          }
        />
      </Field>
      <Field label="Model" htmlFor="assist-model">
        <input id="assist-model" className="field mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder={info?.default_model} />
      </Field>
      <div className="flex items-center gap-1">
        <Button variant="primary" onClick={() => save()}>
          Save settings
        </Button>
        {info?.source === "settings" && (
          <Button variant="danger" onClick={() => save(true)}>
            Remove key
          </Button>
        )}
        {msg && <span className="text-[11.5px] text-muted ml-1">{msg}</span>}
      </div>
      <p className="text-[11px] text-muted leading-snug break-all">
        Keys stay on this computer ({status?.settings_file ?? "settings file"}) and are never sent to the browser.
      </p>
    </div>
  );
}
