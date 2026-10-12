import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { api } from "../../services/api";
import type { AssistImage, AssistProvider, AssistStatus, ForwardOptions, SystemSpec, TimeSpan } from "../../types/api";
import { Button, Field, Section } from "../common/controls";

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

/** What the assistant can change: the system, its time span and the solver options. */
export interface Definition {
  system: SystemSpec;
  time: TimeSpan;
  options: ForwardOptions;
}

const OPTION_KEYS = (o: ForwardOptions) => Object.keys(o).sort() as (keyof ForwardOptions)[];
const sameDefinition = (a: Definition, b: Definition) =>
  JSON.stringify([a.system.name, a.system.states, a.system.parameters, a.system.equations, a.time.t0, a.time.t1, OPTION_KEYS(a.options).map((k) => a.options[k])]) ===
  JSON.stringify([b.system.name, b.system.states, b.system.parameters, b.system.equations, b.time.t0, b.time.t1, OPTION_KEYS(b.options).map((k) => b.options[k])]);

/** "n_seg 50→100, use_lbfgs true→false" */
const optionChanges = (a: ForwardOptions, b: ForwardOptions) =>
  OPTION_KEYS(b)
    .filter((k) => a[k] !== b[k])
    .map((k) => `${k} ${a[k]}→${b[k]}`)
    .join(", ");

/** One chat line. Assistant lines that changed the editor keep what was there before, for Undo. */
export interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  meta?: string;
  before?: Definition;
  after?: Definition;
  images?: string[]; // thumbnails of what the user attached
}

const EXAMPLES = ["Damped pendulum, gamma = 0.5, for 10 s", "Lorenz system with the classic parameters", "Use 100 segments and turn off L-BFGS"];

/**
 * "Describe your system" chat for the Forward module. The backend asks the configured LLM for a
 * system definition, validates it with the equation parser, and the result fills the editor.
 * Nothing runs until the user presses Run.
 */
export function AssistChat({
  system,
  time,
  options,
  onApply,
  chat,
  setChat,
  disabled,
}: {
  system: SystemSpec;
  time: TimeSpan;
  options: ForwardOptions;
  onApply: (d: Definition) => void;
  chat: ChatEntry[];
  setChat: (update: (c: ChatEntry[]) => ChatEntry[]) => void;
  disabled: boolean;
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
  }, [chat, busy]);

  const ready = !!status?.provider;
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
    if ((!text && !attachments.length) || busy || !ready) return;
    const images = attachments;
    setPrompt("");
    setAttachments([]);
    setBusy(true);
    const history = chat.filter((m) => !m.error).slice(-10).map(({ role, content, images: imgs }) => ({
      role,
      content: imgs?.length ? `${content || "(image)"} [${imgs.length} image(s) attached]` : content,
    }));
    setChat((c) => [...c, { role: "user", content: text, images: images.map((im) => im.url) }]);
    try {
      const r = await api.assistForward({
        prompt: text,
        images: images.map(({ media_type, data }) => ({ media_type, data })),
        current_system: system,
        current_time: time,
        current_options: options,
        history,
        language: navigator.language,
      });
      const before: Definition = { system, time, options };
      const after: Definition = { system: r.system, time: r.time, options: r.options };
      const changed = !sameDefinition(before, after);
      if (changed) onApply(after);
      const states = r.system.states.map((s) => s.name).join(", ");
      const opts = optionChanges(options, r.options);
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          content: r.reply || `Set up ${r.system.name}.`,
          meta: changed
            ? `${r.system.name} · states ${states} · t ∈ [${r.time.t0}, ${r.time.t1}]${opts ? ` · solver: ${opts}` : ""} · ${r.model}${r.attempts > 1 ? ` · ${r.attempts} tries` : ""}`
            : `no change to the editor · ${r.model}`,
          before: changed ? before : undefined,
          after: changed ? after : undefined,
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
    if (!b) return;
    onApply(b);
    setChat((c) => c.map((m, j) => (j === i ? { ...m, before: undefined, meta: `${m.meta ?? ""} · undone` } : m)));
  };

  return (
    <Section
      title="AI assistant"
      actions={
        <Button variant="ghost" className="h-6 px-1.5 text-[11.5px]" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>
          {showSettings ? "Close settings" : "Settings"}
        </Button>
      }
    >
      {(showSettings || (status && !ready)) && <AssistSettings status={status} onStatus={setStatus} />}
      {status === null && !showSettings && <p className="text-[12px] text-muted">Assistant unavailable (backend offline).</p>}
      {ready && (
        <div
          className={`flex flex-col gap-2 rounded ${dragging ? "outline-2 outline-dashed outline-accent outline-offset-2" : ""}`}
          onDragOver={(e) => {
            if ([...e.dataTransfer.types].includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p className="text-[11.5px] text-muted leading-snug">
            Describe the system or the solver settings in words, or attach a picture of the equations (paste, drop or 📎).
            The answer fills the editor and the solver panel (checked before applying); review it, then press Run.
          </p>
          <div ref={listRef} className="flex flex-col gap-1.5 max-h-[300px] overflow-y-auto" aria-live="polite">
            {chat.length === 0 && (
              <div className="flex flex-col gap-1">
                {EXAMPLES.map((x) => (
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
                  {m.after && !sameDefinition(m.after, { system, time, options }) && (
                    <button
                      type="button"
                      className="mt-1 text-[11.5px] text-ink-2 underline cursor-pointer hover:text-ink"
                      title="The editor no longer shows this answer's system"
                      onClick={() => onApply(m.after!)}
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
            Describe the system
          </label>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Attached images">
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
            className="field min-h-[64px] resize-y text-[12.5px] leading-snug py-1.5"
            placeholder="e.g. Van der Pol oscillator with mu = 2, x(0) = 1, for 20 s"
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
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted truncate" title={status?.providers[status.provider!]?.model}>
              {status?.providers[status.provider!]?.label} · {status?.providers[status.provider!]?.model}
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
        </div>
      )}
    </Section>
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
    <div className="flex flex-col gap-2 mb-3">
      {status && !status.provider && (
        <p className="text-[12px] text-ink-2 leading-snug">
          Add an Anthropic or OpenAI API key to describe systems in words. Each request is billed to that key.
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
