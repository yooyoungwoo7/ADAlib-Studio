import type { FigureStyle } from "./plots/figureStyle";
import type { ParsedCsv } from "./services/csv";
import type {
  Example,
  InverseOptions,
  InverseRunRequest,
  BuiltinMPCSystem,
  MPCController,
  MPCControllerId,
  MPCLoopRequest,
  MPCOptions,
  MPCSurrogate,
  MPCTrainRequest,
  ForwardOptions,
  ForwardRunRequest,
  ModuleId,
  OperatorOptions,
  OperatorTrainRequest,
  BuiltinOperatorSystem,
  SystemSpec,
  TimeSpan,
  PlotStyle,
} from "./types/api";

export const PROJECT_FORMAT = "adalib-studio-project";
export const PROJECT_VERSION = 2;

export interface ForwardProject {
  exampleId: string | null;
  system: SystemSpec;
  time: TimeSpan;
  options: ForwardOptions;
  reference: boolean;
  /** figure style for the trajectory plots (set by the AI assistant); empty = Paper/Screen look */
  plotStyle?: PlotStyle;
}

export interface OperatorProject {
  exampleId: string | null;
  source: "custom" | "builtin";
  builtin: BuiltinOperatorSystem;
  system: SystemSpec;
  n_seg: number;
  t_final: number;
  options: OperatorOptions;
  presetId: string | null;
  /** model selected for prediction */
  modelId: string | null;
}

export interface InverseUnknown {
  estimate: boolean;
  initial: number;
  lower: number | null;
  upper: number | null;
}

export interface InverseProject {
  exampleId: string | null;
  /** parameter values: fixed values, and the true values for synthetic data */
  system: SystemSpec;
  time: TimeSpan;
  unknowns: Record<string, InverseUnknown>;
  dataSource: "synthetic" | "upload";
  synthetic: { n_points: number; noise_pct: number; seed: number; observed: string[] };
  /** uploaded file (kept in the project so a saved project re-runs as is) */
  upload: { filename: string; csv: ParsedCsv; tCol: number | null; stateCols: Record<string, number | null> } | null;
  /** with uploads: report errors against the parameter values entered above */
  compareToValues: boolean;
  options: InverseOptions;
}

export interface MPCProject {
  exampleId: string | null;
  source: "custom" | "builtin";
  system: SystemSpec;
  dt: number;
  /** tracked states and their references (custom) */
  targets: Record<string, number>;
  trackingWeights: Record<string, number>;
  controlWeights: Record<string, number>;
  builtin: BuiltinMPCSystem;
  /** per built-in system: x0, targets, control bounds */
  builtinX0: Partial<Record<BuiltinMPCSystem, number[]>>;
  builtinTargets: Partial<Record<BuiltinMPCSystem, Record<string, number>>>;
  builtinBounds: Partial<Record<BuiltinMPCSystem, Record<string, [number, number]>>>;
  options: MPCOptions;
  presetId: string | null;
  /** trained surrogate the closed loop runs on */
  surrogateId: string | null;
  /** controllers compared on that surrogate */
  controllers: MPCControllerId[];
}

export interface Project {
  name: string;
  module: ModuleId;
  forward: ForwardProject;
  operator: OperatorProject;
  inverse: InverseProject;
  mpc: MPCProject;
  /** AI figure styles (Plotly patches) per module; see plots/figureStyle.ts */
  figures?: Partial<Record<ModuleId, FigureStyle>>;
}

// adalib 0.1.0 MPCOptions defaults (backend/app/schemas/mpc.py mirrors them)
export const MPC_DEFAULTS: MPCOptions = {
  n_steps: 20,
  horizon: null,
  gradient: null,
  optimizer: "SLSQP",
  n_train: 200,
  n_val: 50,
  epochs: 300,
  batch_size: 256,
  lr: 3e-3,
  hidden: 256,
  n_layers: 4,
  seed: 42,
  basis: "lpa",
  use_lr_schedule: true,
  plant_solver: "RK45",
  lpa_n_panels: 8,
  lpa_max_order: 6,
  lpa_nt_seg: 20,
};

export function blankMpc(): MPCProject {
  return {
    exampleId: null,
    source: "custom",
    system: {
      name: "custom_system",
      states: [{ name: "x", initial: 0, lower: -2, upper: 2 }],
      parameters: [{ name: "k", value: 1 }],
      controls: [{ name: "u", value: 0, lower: -1, upper: 1 }],
      equations: ["-k*x + u"],
    },
    dt: 0.1,
    targets: { x: 0.5 },
    trackingWeights: {},
    controlWeights: {},
    builtin: "cstr",
    builtinX0: {},
    builtinTargets: {},
    builtinBounds: {},
    options: { ...MPC_DEFAULTS, n_train: 200, n_val: 40, epochs: 100, hidden: 128, n_layers: 3 },
    presetId: "standard",
    surrogateId: null,
    controllers: ["autodiff"],
  };
}

/** The paper's surrogate controllers (Sec. MPC): same SLSQP with FD or AD gradients, and batched sampling. */
export const MPC_CONTROLLERS: { id: MPCControllerId; label: string; title: string; builtinOnly: boolean }[] = [
  { id: "fd", label: "FD", title: "SLSQP, finite-difference gradient of the horizon cost", builtinOnly: false },
  { id: "autodiff", label: "AD", title: "SLSQP, exact gradient by automatic differentiation through the surrogate", builtinOnly: false },
  { id: "CEM", label: "CEM", title: "Cross-entropy method: 512 candidate sequences x 8 iterations, evaluated as batches", builtinOnly: true },
  { id: "MPPI", label: "MPPI", title: "Model-predictive path integral: 512 rollouts x 4 iterations, evaluated as batches", builtinOnly: true },
];

export function controllerSpec(id: MPCControllerId): MPCController {
  return id === "CEM" || id === "MPPI" ? { gradient: null, optimizer: id } : { gradient: id, optimizer: "SLSQP" };
}

export function mpcFromExample(ex: Example, prev: MPCProject): MPCProject {
  const m = ex.mpc;
  return {
    ...prev,
    exampleId: ex.id,
    source: "custom",
    system: structuredClone(ex.system),
    dt: m?.dt ?? prev.dt,
    targets: { ...(m?.targets ?? {}) },
    trackingWeights: { ...(m?.tracking_weights ?? {}) },
    controlWeights: { ...(m?.control_weights ?? {}) },
    options: { ...MPC_DEFAULTS, ...(m?.options ?? {}) },
    presetId: null,
  };
}

export function mpcTrainIssues(p: MPCProject): string[] {
  const out: string[] = [];
  if (p.options.n_val > p.options.n_train) out.push("Validation samples must not exceed training samples.");
  if (p.source === "builtin") return out;
  if (!(p.system.controls ?? []).length) out.push("Add at least one control input.");
  for (const s of p.system.states) if (s.lower == null || s.upper == null || !(s.upper > s.lower)) out.push(`State ${s.name}: set a range with upper > lower.`);
  if (!(p.dt > 0)) out.push("The control interval dt must be positive.");
  return out;
}

export function mpcRunIssues(p: MPCProject): string[] {
  const out: string[] = [];
  if (!p.controllers.length) out.push("Select at least one controller.");
  if (p.source === "builtin") return out;
  if (!Object.keys(p.targets).some((n) => p.system.states.some((s) => s.name === n))) out.push("Choose at least one state to track.");
  if (p.controllers.some((c) => c === "CEM" || c === "MPPI")) out.push("Custom systems use FD or AD (CEM/MPPI are built-in only in adalib 0.1.0).");
  return out;
}

const trimmed = (sys: SystemSpec): SystemSpec => ({
  ...sys,
  states: sys.states.map((s) => ({ ...s, name: s.name.trim() })),
  parameters: sys.parameters.map((q) => ({ ...q, name: q.name.trim() })),
  controls: (sys.controls ?? []).map((c) => ({ ...c, name: c.name.trim() })),
});

export function mpcTrainRequest(p: MPCProject): MPCTrainRequest {
  const o = p.options;
  const options = {
    n_train: o.n_train, n_val: o.n_val, epochs: o.epochs, batch_size: o.batch_size, lr: o.lr, hidden: o.hidden,
    n_layers: o.n_layers, seed: o.seed, basis: o.basis, use_lr_schedule: o.use_lr_schedule,
    lpa_n_panels: o.lpa_n_panels, lpa_max_order: o.lpa_max_order, lpa_nt_seg: o.lpa_nt_seg,
  };
  return p.source === "builtin"
    ? { source: "builtin", builtin: p.builtin, system: null, dt: p.dt, options }
    : { source: "custom", builtin: null, system: trimmed(p.system), dt: p.dt, options };
}

/** What a custom surrogate was trained on: equations, parameter values, state/control boxes and dt
 *  (initial values, references and weights are closed-loop settings). */
function surrogateKey(sys: SystemSpec, dt: number | null) {
  const t = trimmed(sys);
  return JSON.stringify({
    states: t.states.map((s) => [s.name, s.lower, s.upper]),
    parameters: t.parameters.map((q) => [q.name, q.value]),
    controls: (t.controls ?? []).map((c) => [c.name, c.lower, c.upper]),
    equations: t.equations.map((e) => e.replace(/\s+/g, "")),
    dt,
  });
}

export function surrogateMatches(p: MPCProject, m: MPCSurrogate): boolean {
  if (p.source !== m.source) return false;
  if (p.source === "builtin") return m.builtin === p.builtin;
  return !!m.spec && surrogateKey(m.spec, m.dt) === surrogateKey(p.system, p.dt);
}

export function mpcLoopRequest(
  p: MPCProject,
  m: MPCSurrogate,
  builtin?: { x0: number[]; targets: Record<string, number>; control_bounds: Record<string, [number, number]> },
): MPCLoopRequest {
  const common = { model_id: m.model_id, n_steps: p.options.n_steps, horizon: p.options.horizon, plant_solver: p.options.plant_solver, controllers: p.controllers.map(controllerSpec) };
  if (p.source === "builtin") {
    return {
      ...common,
      x0: p.builtinX0[p.builtin] ?? builtin?.x0 ?? [],
      targets: p.builtinTargets[p.builtin] ?? builtin?.targets ?? {},
      tracking_weights: {},
      control_weights: {},
      control_bounds: p.builtinBounds[p.builtin] ?? builtin?.control_bounds ?? {},
    };
  }
  const names = p.system.states.map((s) => s.name.trim());
  return {
    ...common,
    x0: p.system.states.map((s) => s.initial),
    targets: Object.fromEntries(Object.entries(p.targets).filter(([n]) => names.includes(n))),
    tracking_weights: p.trackingWeights,
    control_weights: p.controlWeights,
    control_bounds: {},
  };
}

// Used only until /api/capabilities answers; the backend asserts these equal
// adalib 0.1.0's ForwardOptions defaults (backend/tests/test_package.py).
export const FALLBACK_FORWARD_DEFAULTS: ForwardOptions = {
  basis: "adaf",
  n_seg: 50,
  N_p: 5,
  N_m: 100,
  Nt_total: 2500,
  epochs: 5,
  adam_inner: 100,
  adam_lr: 1e-3,
  use_lbfgs: true,
  dtype: "float64",
  gamma: 0.8,
  L: 1.0,
  order: 3,
};

// adalib 0.1.0 OperatorOptions defaults (backend/app/schemas/operator.py mirrors them)
export const OPERATOR_DEFAULTS: OperatorOptions = {
  n_train: 2000,
  n_val: 200,
  epochs: 1000,
  batch_size: 256,
  lr: 3e-3,
  hidden: 128,
  n_layers: 3,
  seed: 42,
  basis: "lpa",
  use_lr_schedule: true,
  lpa_n_panels: 8,
  lpa_max_order: 6,
  lpa_nt_seg: 20,
};

// adalib 0.1.0 InverseOptions defaults (backend/app/schemas/inverse.py mirrors them)
export const INVERSE_DEFAULTS: InverseOptions = {
  lambda_physics: 1.0,
  lambda_data: 10.0,
  n_seg: 20,
  N_p: 5,
  N_m: 100,
  Nt_total: 1000,
  gamma: 0.8,
  L: 1.0,
  epochs: 5,
  adam_inner: 200,
  adam_lr: 1e-3,
  use_lbfgs: true,
  n_passes: 1,
  warm_seg_passes: 1,
  n_warm_segs: 3,
  training_strategy: "joint",
  data_prefit_steps: 0,
  normalize_data_loss: true,
  normalize_physics_loss: false,
  param_log_every: 1,
  dtype: "float64",
};

export function blankInverse(): InverseProject {
  return {
    exampleId: null,
    system: { name: "custom_system", states: [{ name: "x", initial: 1 }], parameters: [{ name: "k", value: 1 }], equations: ["-k*x"] },
    time: { t0: 0, t1: 1 },
    unknowns: { k: { estimate: true, initial: 0.5, lower: 0, upper: null } },
    dataSource: "synthetic",
    synthetic: { n_points: 100, noise_pct: 1, seed: 42, observed: [] },
    upload: null,
    compareToValues: false,
    options: { ...INVERSE_DEFAULTS },
  };
}

export function inverseFromExample(ex: Example): InverseProject {
  const inv = ex.inverse;
  const unknowns: Record<string, InverseUnknown> = {};
  for (const p of ex.system.parameters) {
    const u = inv?.unknowns.find((x) => x.name === p.name);
    unknowns[p.name] = u
      ? { estimate: true, initial: u.initial, lower: u.lower, upper: u.upper }
      : { estimate: false, initial: p.value, lower: null, upper: null };
  }
  return {
    ...blankInverse(),
    exampleId: ex.id,
    system: structuredClone(ex.system),
    time: { ...ex.time },
    unknowns,
    synthetic: { ...(inv?.synthetic ?? { n_points: 100, noise_pct: 1, seed: 42 }), observed: [] },
    options: { ...INVERSE_DEFAULTS, ...(inv?.options ?? {}) },
  };
}

export function inverseUnknown(p: InverseProject, name: string): InverseUnknown {
  const v = p.system.parameters.find((q) => q.name === name)?.value ?? 1;
  return p.unknowns[name] ?? { estimate: false, initial: v, lower: null, upper: null };
}

export function inverseIssues(p: InverseProject): string[] {
  const out: string[] = [];
  const names = p.system.parameters.map((q) => q.name);
  const est = names.filter((n) => inverseUnknown(p, n).estimate);
  if (!est.length) out.push("Mark at least one parameter to estimate.");
  for (const n of est) {
    const u = inverseUnknown(p, n);
    if (u.lower != null && u.upper != null && !(u.upper > u.lower)) out.push(`${n}: upper bound must exceed lower bound.`);
    else if (u.lower != null && !(u.initial > u.lower)) out.push(`${n}: the initial guess must be above the lower bound.`);
    else if (u.upper != null && !(u.initial < u.upper)) out.push(`${n}: the initial guess must be below the upper bound.`);
  }
  if (!(p.time.t1 > p.time.t0)) out.push("t_end must be greater than t_start.");
  if (p.dataSource === "upload" && !p.upload) out.push("Upload an observation file (CSV).");
  return out;
}

export function inverseRequest(p: InverseProject): InverseRunRequest {
  const names = p.system.parameters.map((q) => q.name.trim());
  const unknowns = names
    .filter((n) => inverseUnknown(p, n).estimate)
    .map((n) => {
      const u = inverseUnknown(p, n);
      return { name: n, initial: u.initial, lower: u.lower, upper: u.upper };
    });
  const system = {
    ...p.system,
    states: p.system.states.map((s) => ({ name: s.name.trim(), initial: s.initial })),
    parameters: p.system.parameters.map((q) => ({ name: q.name.trim(), value: q.value })),
    controls: [],
  };
  const base = { system, time: p.time, unknowns, options: p.options };
  if (p.dataSource === "synthetic") {
    return { ...base, data_source: "synthetic", synthetic: { ...p.synthetic, true_values: {} }, upload: null, reference_values: {} };
  }
  const up = p.upload!;
  const columns: Record<string, (number | null)[]> = {};
  for (const [state, col] of Object.entries(up.stateCols)) if (col != null) columns[state] = up.csv.rows.map((r) => r[col]);
  const reference_values: Record<string, number> = {};
  if (p.compareToValues) for (const u of unknowns) reference_values[u.name] = p.system.parameters.find((q) => q.name.trim() === u.name)!.value;
  return {
    ...base,
    data_source: "upload",
    upload: { t: up.csv.rows.map((r) => (up.tCol == null ? null : r[up.tCol])), columns, filename: up.filename },
    synthetic: null,
    reference_values,
  };
}

export function blankForward(defaults: ForwardOptions): ForwardProject {
  return {
    exampleId: null,
    system: { name: "custom_system", states: [{ name: "x", initial: 1 }], parameters: [{ name: "k", value: 1 }], equations: ["-k*x"] },
    time: { t0: 0, t1: 1 },
    options: { ...defaults },
    reference: true,
  };
}

export function blankOperator(): OperatorProject {
  return {
    exampleId: null,
    source: "custom",
    builtin: "triple_tank",
    system: {
      name: "custom_system",
      states: [{ name: "x", initial: 1, lower: -2, upper: 2 }],
      parameters: [{ name: "k", value: 1 }],
      controls: [{ name: "u", value: 0, lower: -1, upper: 1 }],
      equations: ["-k*x + u"],
    },
    n_seg: 25,
    t_final: 5,
    // custom (generic) path: adalib's defaults train in ~20 s and reached ~1-2 % error in tests,
    // "Standard" is faster but coarse (20-30 %)
    options: { ...OPERATOR_DEFAULTS },
    presetId: "adalib",
    modelId: null,
  };
}

export function blankProject(defaults: ForwardOptions): Project {
  return { name: "Untitled project", module: "forward", forward: blankForward(defaults), operator: blankOperator(), inverse: blankInverse(), mpc: blankMpc() };
}

export function forwardFromExample(ex: Example, defaults: ForwardOptions): ForwardProject {
  return {
    exampleId: ex.id,
    system: structuredClone(ex.system),
    time: { ...ex.time },
    options: { ...defaults, ...ex.options },
    reference: true,
  };
}

export function operatorFromExample(ex: Example, prev: OperatorProject): OperatorProject {
  return {
    ...prev,
    exampleId: ex.id,
    source: "custom",
    system: structuredClone(ex.system),
    n_seg: ex.operator?.n_seg ?? prev.n_seg,
    t_final: ex.operator?.t_final ?? prev.t_final,
  };
}

export function forwardRequest(p: ForwardProject): ForwardRunRequest {
  return {
    system: {
      ...p.system,
      states: p.system.states.map((s) => ({ name: s.name.trim(), initial: s.initial })),
      parameters: p.system.parameters.map((q) => ({ name: q.name.trim(), value: q.value })),
      controls: [],
    },
    time: p.time,
    options: p.options,
    reference: p.reference,
  };
}

export function operatorRequest(p: OperatorProject, label: string): OperatorTrainRequest {
  if (p.source === "builtin") {
    return { source: "builtin", builtin: p.builtin, system: null, n_seg: p.n_seg, t_final: p.t_final, options: p.options, label };
  }
  return {
    source: "custom",
    builtin: null,
    system: {
      ...p.system,
      states: p.system.states.map((s) => ({ ...s, name: s.name.trim() })),
      parameters: p.system.parameters.map((q) => ({ ...q, name: q.name.trim() })),
      controls: (p.system.controls ?? []).map((c) => ({ ...c, name: c.name.trim() })),
    },
    n_seg: p.n_seg,
    t_final: p.t_final,
    options: p.options,
    label,
  };
}

/** Client-side checks that don't need the parser; the backend re-validates everything. */
export function localIssues(p: ForwardProject): string[] {
  const out: string[] = [];
  const { options: o, time, system } = p;
  if (!(time.t1 > time.t0)) out.push("t_end must be greater than t_start.");
  if (o.basis === "adaf" && o.Nt_total % o.n_seg !== 0)
    out.push(`Nt_total (${o.Nt_total}) must be divisible by n_seg (${o.n_seg}) for the ADA-F basis.`);
  const numbers = [time.t0, time.t1, ...system.states.map((s) => s.initial), ...system.parameters.map((q) => q.value)];
  if (numbers.some((v) => !Number.isFinite(v))) out.push("All initial conditions, parameters and times must be numbers.");
  if (system.states.length === 0) out.push("Define at least one state variable.");
  return out;
}

export function operatorIssues(p: OperatorProject): string[] {
  const out: string[] = [];
  if (p.options.n_val > p.options.n_train) out.push("Validation samples (n_val) must not exceed training samples.");
  if (p.source === "builtin") return out;
  for (const s of p.system.states) {
    if (s.lower == null || s.upper == null || !(s.upper > s.lower)) out.push(`State ${s.name || "?"}: set a training range with upper > lower.`);
  }
  for (const c of p.system.controls ?? []) {
    if (!(c.upper > c.lower)) out.push(`Control ${c.name || "?"}: upper bound must exceed lower bound.`);
  }
  if (!(p.t_final > 0)) out.push("The rollout horizon must be positive.");
  return out;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  saved_at: string;
  project: Project;
  last_job_id: string | null;
}

export function serializeProject(p: Project, lastJobId: string | null): string {
  const file: ProjectFile = { format: PROJECT_FORMAT, version: PROJECT_VERSION, saved_at: new Date().toISOString(), project: p, last_job_id: lastJobId };
  return JSON.stringify(file, null, 2);
}

function validSystem(s: unknown): s is SystemSpec {
  const x = s as SystemSpec;
  return !!x && Array.isArray(x.states) && Array.isArray(x.equations) && Array.isArray(x.parameters);
}

export function parseProjectFile(text: string, defaults: ForwardOptions): ProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const f = data as Partial<ProjectFile> & { version?: number };
  if (f?.format !== PROJECT_FORMAT || typeof f.project !== "object" || !f.project) {
    throw new Error("Not an ADALib Studio project file.");
  }
  if ((f.version ?? 0) > PROJECT_VERSION) throw new Error(`Project file version ${f.version} is newer than this app.`);
  const raw = f.project as unknown as Record<string, unknown>;
  // v1 kept the Forward fields at the top level
  const fwdRaw = (f.version ?? 1) < 2 ? raw : (raw.forward as Record<string, unknown> | undefined);
  if (!fwdRaw || !validSystem(fwdRaw.system)) throw new Error("Project file has no valid system definition.");
  const base = blankProject(defaults);
  const opRaw = (raw.operator ?? {}) as Partial<OperatorProject>;
  const invRaw = (raw.inverse ?? {}) as Partial<InverseProject>;
  const mpcRaw = (raw.mpc ?? {}) as Partial<MPCProject>;
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    saved_at: f.saved_at ?? "",
    last_job_id: f.last_job_id ?? null,
    project: {
      name: (raw.name as string) ?? "Opened project",
      module: (raw.module as ModuleId) ?? "forward",
      forward: {
        exampleId: (fwdRaw.exampleId as string) ?? null,
        system: fwdRaw.system as SystemSpec,
        time: (fwdRaw.time as TimeSpan) ?? { t0: 0, t1: 1 },
        options: { ...defaults, ...((fwdRaw.options as Partial<ForwardOptions>) ?? {}) },
        reference: (fwdRaw.reference as boolean) ?? true,
        plotStyle: (fwdRaw.plotStyle as PlotStyle | undefined) ?? undefined,
      },
      operator: {
        ...base.operator,
        ...opRaw,
        system: validSystem(opRaw.system) ? opRaw.system : base.operator.system,
        options: { ...OPERATOR_DEFAULTS, ...(opRaw.options ?? {}) },
      },
      inverse: {
        ...base.inverse,
        ...invRaw,
        system: validSystem(invRaw.system) ? invRaw.system : base.inverse.system,
        options: { ...INVERSE_DEFAULTS, ...(invRaw.options ?? {}) },
      },
      mpc: {
        ...base.mpc,
        ...mpcRaw,
        system: validSystem(mpcRaw.system) ? mpcRaw.system : base.mpc.system,
        options: { ...MPC_DEFAULTS, ...(mpcRaw.options ?? {}) },
        controllers: Array.isArray(mpcRaw.controllers) && mpcRaw.controllers.length ? mpcRaw.controllers : base.mpc.controllers,
      },
      figures: raw.figures && typeof raw.figures === "object" ? (raw.figures as Project["figures"]) : undefined,
    },
  };
}

export function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string) {
  return s.trim().replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "project";
}
