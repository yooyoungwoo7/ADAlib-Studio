import { useCallback, useEffect, useRef, useState } from "react";
import type { PlotStyle } from "../plots/theme";
import { api } from "../services/api";
import type { Capabilities, Health, JobResult, JobStatus, SystemSpec, ValidateResponse } from "../types/api";

// ── theme ────────────────────────────────────────────────────────────────
export type ThemePref = "system" | "light" | "dark";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem("adalib-studio-theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Returns the preference and the *resolved* theme (used to re-theme plots). */
function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(() => {
    const p = readPref();
    applyTheme(p);
    return p;
  });
  // apply before re-rendering so charts read the new tokens on this render
  const setPref = useCallback((p: ThemePref) => {
    applyTheme(p);
    setPrefState(p);
  }, []);
  const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const [osDark, setOsDark] = useState(media?.matches ?? false);
  useEffect(() => {
    if (!media) return;
    const on = (e: MediaQueryListEvent) => setOsDark(e.matches);
    media.addEventListener("change", on);
    return () => media.removeEventListener("change", on);
  }, [media]);
  useEffect(() => {
    try {
      localStorage.setItem("adalib-studio-theme", pref);
    } catch {
      /* storage unavailable */
    }
  }, [pref]);
  const resolved: "light" | "dark" = pref === "system" ? (osDark ? "dark" : "light") : pref;
  return { pref, setPref, resolved };
}

// ── plot style ───────────────────────────────────────────────────────────
export type { PlotStyle };

function applyPlotStyle(s: PlotStyle) {
  document.documentElement.setAttribute("data-plot-style", s);
}

/** "paper" (manuscript figure style, default) or "screen" (follows the app theme). */
export function usePlotStyle() {
  const [style, setStyleState] = useState<PlotStyle>(() => {
    let s: PlotStyle = "paper";
    try {
      if (localStorage.getItem("adalib-studio-plot-style") === "screen") s = "screen";
    } catch {
      /* storage unavailable */
    }
    applyPlotStyle(s);
    return s;
  });
  const setStyle = useCallback((s: PlotStyle) => {
    applyPlotStyle(s);
    setStyleState(s);
    try {
      localStorage.setItem("adalib-studio-plot-style", s);
    } catch {
      /* storage unavailable */
    }
  }, []);
  return { style, setStyle };
}

// ── backend connection ───────────────────────────────────────────────────
export type Connection = "connecting" | "online" | "offline";

export function useBackend() {
  const [health, setHealth] = useState<Health | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [conn, setConn] = useState<Connection>("connecting");
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const h = await api.health();
        if (!alive) return;
        setHealth(h);
        setConn("online");
        if (!caps) setCaps(await api.capabilities());
      } catch {
        if (alive) setConn("offline");
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [caps]);
  return { health, caps, conn };
}

// ── job polling ──────────────────────────────────────────────────────────
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function useJob(jobId: string | null, onFinished?: (st: JobStatus) => void) {
  // Everything is tagged with the job it belongs to: when jobId changes, the
  // previous job's data must not be visible for even one render (consumers
  // would attribute an old result to the new job).
  const [state, setState] = useState<{ id: string | null; status: JobStatus | null; log: string; result: JobResult | null; error: string | null }>({
    id: null,
    status: null,
    log: "",
    result: null,
    error: null,
  });
  const offset = useRef(0);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    setState({ id: jobId, status: null, log: "", result: null, error: null });
    offset.current = 0;
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const patch = (fn: (s: typeof state) => typeof state) => alive && setState((s) => (s.id === jobId ? fn(s) : s));

    const poll = async () => {
      try {
        const [st, lg] = await Promise.all([api.job(jobId), api.log(jobId, offset.current)]);
        if (!alive) return;
        if (lg.text) offset.current = lg.offset;
        patch((s) => ({ ...s, status: st, log: lg.text ? s.log + lg.text : s.log, error: null }));
        if (TERMINAL.has(st.status)) {
          if (st.status === "completed") {
            const res = await api.result(jobId);
            patch((s) => ({ ...s, result: res }));
          }
          finished.current?.(st);
          return;
        }
      } catch (e) {
        patch((s) => ({ ...s, error: (e as Error).message }));
      }
      if (alive) timer = setTimeout(poll, 1000);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    const st = await api.cancel(jobId);
    setState((s) => (s.id === jobId ? { ...s, status: st } : s));
  }, [jobId]);

  const current = state.id === jobId;
  return {
    status: current ? state.status : null,
    log: current ? state.log : "",
    result: current ? state.result : null,
    error: current ? state.error : null,
    cancel,
  };
}

/** Seconds since `iso`, re-rendering every second while `active`. */
export function useElapsed(startIso: string | null | undefined, endIso: string | null | undefined, active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!startIso) return null;
  const end = endIso ? Date.parse(endIso) : now;
  return Math.max(0, (end - Date.parse(startIso)) / 1000);
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(query: string) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : true);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    m.addEventListener("change", on);
    on();
    return () => m.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** Debounced server-side validation; a result is only returned while it
 *  describes the system currently being edited. */
export function useSystemValidation(system: SystemSpec, conn: Connection, enabled = true) {
  const [checked, setChecked] = useState<{ key: string; v: ValidateResponse } | null>(null);
  const key = JSON.stringify(system);
  const debounced = useDebounced(system, 300);
  useEffect(() => {
    if (conn !== "online" || !enabled) return;
    let alive = true;
    const k = JSON.stringify(debounced);
    api
      .validate(debounced)
      .then((v) => alive && setChecked({ key: k, v }))
      .catch(
        (e) =>
          alive &&
          setChecked({ key: k, v: { ok: false, errors: [{ message: (e as Error).message, index: null, field: null }], latex: [], symbols: [], unused_parameters: [] } }),
      );
    return () => {
      alive = false;
    };
  }, [debounced, conn, enabled]);
  const validation = checked && checked.key === key ? checked.v : null;
  return { validation, validating: conn === "online" && enabled && !validation };
}
