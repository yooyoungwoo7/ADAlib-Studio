import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../services/api";
import type { AssistProvider, AssistStatus, SystemSpec, TimeSpan } from "../../types/api";
import { Button, Field, Section } from "../common/controls";

/** One chat line. Assistant lines that changed the editor keep what was there before, for Undo. */
export interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  meta?: string;
  before?: { system: SystemSpec; time: TimeSpan };
}

const EXAMPLES = ["Damped pendulum, gamma = 0.5, for 10 s", "Lorenz system with the classic parameters", "Set mu to 3 and solve until t = 8"];

/**
 * "Describe your system" chat for the Forward module. The backend asks the configured LLM for a
 * system definition, validates it with the equation parser, and the result fills the editor.
 * Nothing runs until the user presses Run.
 */
export function AssistChat({
  system,
  time,
  onApply,
  chat,
  setChat,
  disabled,
}: {
  system: SystemSpec;
  time: TimeSpan;
  onApply: (system: SystemSpec, time: TimeSpan) => void;
  chat: ChatEntry[];
  setChat: (update: (c: ChatEntry[]) => ChatEntry[]) => void;
  disabled: boolean;
}) {
  const [status, setStatus] = useState<AssistStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;
    api.assistStatus().then(setStatus).catch(() => setStatus(null));
  }, [disabled]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat, busy]);

  const ready = !!status?.provider;
  const send = async (text = prompt.trim()) => {
    if (!text || busy || !ready) return;
    setPrompt("");
    setBusy(true);
    const history = chat.filter((m) => !m.error).slice(-10).map(({ role, content }) => ({ role, content }));
    setChat((c) => [...c, { role: "user", content: text }]);
    try {
      const r = await api.assistForward({ prompt: text, current_system: system, current_time: time, history, language: navigator.language });
      const before = { system, time };
      onApply(r.system, r.time);
      const states = r.system.states.map((s) => s.name).join(", ");
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          content: r.reply || `Set up ${r.system.name}.`,
          meta: `${r.system.name} · states ${states} · t ∈ [${r.time.t0}, ${r.time.t1}] · ${r.model}${r.attempts > 1 ? ` · ${r.attempts} tries` : ""}`,
          before,
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
    onApply(b.system, b.time);
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
        <div className="flex flex-col gap-2">
          <p className="text-[11.5px] text-muted leading-snug">
            Describe the system in words. The answer fills the editor (checked by the equation parser); review it, then press Run.
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
                {m.content}
                {m.meta && <span className="block mt-1 text-[11px] text-muted font-mono break-words">{m.meta}</span>}
                {m.before && (
                  <button type="button" className="mt-1 text-[11.5px] text-ink-2 underline cursor-pointer hover:text-ink" onClick={() => undo(i)}>
                    Undo this change
                  </button>
                )}
              </div>
            ))}
            {busy && <p className="text-[12px] text-muted">Thinking…</p>}
          </div>
          <label htmlFor="assist-prompt" className="sr-only">
            Describe the system
          </label>
          <textarea
            id="assist-prompt"
            className="field min-h-[64px] resize-y text-[12.5px] leading-snug py-1.5"
            placeholder="e.g. Van der Pol oscillator with mu = 2, x(0) = 1, for 20 s"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKey}
            disabled={busy}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted truncate" title={status?.providers[status.provider!]?.model}>
              {status?.providers[status.provider!]?.label} · {status?.providers[status.provider!]?.model}
            </span>
            <div className="flex gap-1">
              {chat.length > 0 && (
                <Button variant="ghost" onClick={() => setChat(() => [])} disabled={busy}>
                  Clear
                </Button>
              )}
              <Button variant="primary" onClick={() => send()} disabled={busy || !prompt.trim()}>
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
