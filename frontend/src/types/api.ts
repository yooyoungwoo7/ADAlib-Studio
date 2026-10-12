// Types mirroring backend/app/schemas and the worker's result.json.

export type ModuleId = "forward" | "operator" | "inverse" | "mpc";

export interface StateSpec {
  name: string;
  initial: number;
  /** training range (Operator / MPC) */
  lower?: number | null;
  upper?: number | null;
}
export interface ControlSpec {
  name: string;
  value: number;
  lower: number;
  upper: number;
}
export interface ParameterSpec {
  name: string;
  value: number;
}
export interface SystemSpec {
  name: string;
  states: StateSpec[];
  parameters: ParameterSpec[];
  equations: string[];
  controls?: ControlSpec[];
}
export interface TimeSpan {
  t0: number;
  t1: number;
}

export interface ForwardOptions {
  basis: "adaf" | "lpa";
  n_seg: number;
  N_p: number;
  N_m: number;
  Nt_total: number;
  epochs: number;
  adam_inner: number;
  adam_lr: number;
  use_lbfgs: boolean;
  dtype: "float32" | "float64";
  gamma: number;
  L: number;
  order: number;
}

export interface ForwardRunRequest {
  system: SystemSpec;
  time: TimeSpan;
  options: ForwardOptions;
  reference: boolean;
}

export interface Example {
  id: string;
  title: string;
  modules: ModuleId[];
  description: string;
  source: string;
  studio_choices: string[];
  system: SystemSpec;
  time: TimeSpan;
  options: Partial<ForwardOptions>;
  phase?: [string, string];
  operator?: { n_seg: number; t_final: number };
  inverse?: {
    unknowns: UnknownParameter[];
    synthetic: { n_points: number; noise_pct: number; seed: number };
    options: Partial<InverseOptions>;
  };
  mpc?: {
    dt: number;
    targets: Record<string, number>;
    tracking_weights: Record<string, number>;
    control_weights: Record<string, number>;
    options: Partial<MPCOptions>;
  };
}

export interface Health {
  status: string;
  adalib_installed: boolean;
  adalib_version: string | null;
  adalib_version_supported: boolean;
  dependencies: Record<string, string | null>;
}

export interface ModuleCapability {
  status: "available" | "planned" | string;
  api?: string;
  note?: string;
  custom_systems?: string;
  option_defaults?: Partial<ForwardOptions> & { error?: string };
  progress?: string;
}

export interface Capabilities {
  adalib_version: string | null;
  parser: {
    functions: string[];
    constants: string[];
    operators: string[];
    time_dependence: boolean;
    time_dependence_note: string;
  };
  modules: Record<ModuleId, ModuleCapability>;
}

export interface EquationIssue {
  message: string;
  index: number | null;
  field: string | null;
}
export interface ValidateResponse {
  ok: boolean;
  errors: EquationIssue[];
  latex: string[];
  symbols: string[][];
  unused_parameters: string[];
}

export type JobState = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface StageRecord {
  unit: "segment" | "epoch" | "full";
  index: number | null;
  total: number | null;
  stage: "Adam" | "L-BFGS";
  seconds: number;
  loss: number | null;
  parts: number[];
  message: string | null;
}

export type JobKind = "forward" | "operator_train" | "operator_infer" | "inverse" | "mpc" | "mpc_train";

export interface JobStatus {
  id: string;
  kind: JobKind;
  label: string;
  status: JobState;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  returncode: number | null;
  error: string | null;
  progress?: (Partial<StageRecord> & { unit: string; stage: string; val_loss?: number | null }) | null;
}

export interface ForwardResult {
  kind: "forward";
  adalib_version: string;
  system: {
    name: string;
    state_names: string[];
    parameter_names: string[];
    parameters: Record<string, number>;
    x0: number[];
  };
  t_span: [number, number];
  options: ForwardOptions;
  n_points: number;
  downsampled: boolean;
  t: (number | null)[];
  y: Record<string, (number | null)[]>;
  dtype_returned: string;
  solver_meta: Record<string, unknown>;
  wall_time_sec: number;
  reference: {
    label: string;
    y: Record<string, (number | null)[]> | null;
    error: string | null;
    warnings?: string[];
  } | null;
  metrics: Record<string, { rel_l2: number | null; max_abs: number }>;
  warnings: string[];
  files: string[];
  history: StageRecord[];
}

// ── operator ─────────────────────────────────────────────────────────────
export type BuiltinOperatorSystem = "cstr" | "triple_tank" | "fedbatch_bioreactor";

export interface OperatorOptions {
  n_train: number;
  n_val: number;
  epochs: number;
  batch_size: number;
  lr: number;
  hidden: number;
  n_layers: number;
  seed: number;
  basis: "lpa" | "adaf";
  use_lr_schedule: boolean;
  lpa_n_panels: number;
  lpa_max_order: number;
  lpa_nt_seg: number;
}

export interface OperatorTrainRequest {
  source: "custom" | "builtin";
  system?: SystemSpec | null;
  n_seg: number;
  t_final: number;
  builtin?: BuiltinOperatorSystem | null;
  options: OperatorOptions;
  label: string;
}

export interface OperatorBuiltin {
  id: BuiltinOperatorSystem;
  title: string;
  description: string;
  source: string;
  states: string[];
  inputs: string[];
  input_ranges: [number, number][];
  time: string;
}
export interface OperatorPreset {
  id: string;
  title: string;
  note: string;
  options: Partial<OperatorOptions>;
}

export interface OperatorManifest {
  model_id: string;
  source: "custom" | "builtin";
  builtin?: BuiltinOperatorSystem;
  system_name: string;
  label: string;
  state_names: string[];
  input_names: string[];
  input_kind: "control" | "parameter";
  domain: { x0: [number, number][]; inputs: [number, number][] };
  nominal: { x0: number[]; inputs: number[] };
  n_seg: number;
  dt_seg: number;
  t_final: number;
  time_unit: string;
  time_factor: number;
  best_val_loss: number | null;
  path: string;
  options: OperatorOptions;
  train_seconds: number;
  trained_at: string;
  adalib_version: string;
  reference_method?: string;
}

export interface OperatorPrediction {
  x0: number[];
  inputs: number[];
  t: (number | null)[];
  y: Record<string, (number | null)[]>;
  predict_seconds: number;
  domain_warnings: string[];
  reference: { label: string; error: string | null; t: (number | null)[] | null; y: Record<string, (number | null)[]> | null } | null;
  metrics: Record<string, { max_abs: number; rmse: number; max_abs_over_range: number | null }>;
}

export interface OperatorTrainResult {
  kind: "operator_train";
  adalib_version: string;
  model_id: string;
  manifest: OperatorManifest;
  train_info: Record<string, unknown>;
  history: { phys_loss?: (number | null)[]; val_phys_loss?: (number | null)[]; lr?: (number | null)[]; epoch?: number[]; source?: string } | null;
  preview: OperatorPrediction;
  train_seconds: number;
  warnings: string[];
}

export interface OperatorInferResult extends OperatorPrediction {
  kind: "operator_infer";
  adalib_version: string;
  model_id: string;
  manifest: OperatorManifest;
  wall_seconds: number;
}

// ── inverse ──────────────────────────────────────────────────────────────
export interface InverseOptions {
  lambda_physics: number;
  lambda_data: number;
  n_seg: number;
  N_p: number;
  N_m: number;
  Nt_total: number;
  gamma: number;
  L: number;
  epochs: number;
  adam_inner: number;
  adam_lr: number;
  use_lbfgs: boolean;
  n_passes: number;
  warm_seg_passes: number;
  n_warm_segs: number;
  training_strategy: "joint" | "alternating";
  data_prefit_steps: number;
  normalize_data_loss: boolean;
  normalize_physics_loss: boolean;
  param_log_every: number;
  dtype: "float32" | "float64";
}

export interface UnknownParameter {
  name: string;
  initial: number;
  lower: number | null;
  upper: number | null;
}

export interface InverseRunRequest {
  system: SystemSpec;
  time: TimeSpan;
  unknowns: UnknownParameter[];
  data_source: "upload" | "synthetic";
  upload?: { t: (number | null)[]; columns: Record<string, (number | null)[]>; filename: string } | null;
  synthetic?: { n_points: number; noise_pct: number; seed: number; observed: string[]; true_values: Record<string, number> } | null;
  reference_values: Record<string, number>;
  options: InverseOptions;
}

type Series = (number | null)[];

export interface InverseResult {
  kind: "inverse";
  adalib_version: string;
  system: { name: string; state_names: string[]; parameter_names: string[]; x0: number[] };
  t_span: [number, number];
  options: InverseOptions;
  parameters: {
    name: string;
    estimated: boolean;
    value: number | null;
    initial?: number;
    lower?: number | null;
    upper?: number | null;
    reference?: number;
    abs_error?: number;
    rel_error?: number | null;
  }[];
  estimated: Record<string, number>;
  observations: {
    t: Series;
    y: Record<string, Series>;
    source: { kind: "upload" | "synthetic"; label: string; n_points: number; noise_pct?: number; seed?: number; true_values?: Record<string, number> };
    notes: string[];
  };
  t: Series;
  y: Record<string, Series>;
  fit: Record<string, { rmse: number; max_abs: number }>;
  residuals: { t: Series; y: Record<string, Series> };
  check: { label: string; error: string | null; y: Record<string, Series> | null };
  history: {
    step: number[];
    n_steps: number;
    total: Series;
    physics: Series;
    data: Series;
    params: Record<string, { step: number[]; value: Series }>;
  };
  runtime_sec: number;
  wall_time_sec: number;
  warnings: string[];
  files: string[];
}

// ── MPC ──────────────────────────────────────────────────────────────────
export type BuiltinMPCSystem = "cstr" | "triple_tank" | "fedbatch_bioreactor";

export interface MPCOptions {
  n_steps: number;
  horizon: number | null;
  gradient: "autodiff" | "fd" | null;
  optimizer: "SLSQP" | "CEM" | "MPPI";
  n_train: number;
  n_val: number;
  epochs: number;
  batch_size: number;
  lr: number;
  hidden: number;
  n_layers: number;
  seed: number;
  basis: "lpa" | "adaf";
  use_lr_schedule: boolean;
  plant_solver: string;
  lpa_n_panels: number;
  lpa_max_order: number;
  lpa_nt_seg: number;
}

export interface MPCRunRequest {
  source: "custom" | "builtin";
  system?: SystemSpec | null;
  dt: number;
  targets: Record<string, number>;
  tracking_weights: Record<string, number>;
  control_weights: Record<string, number>;
  builtin?: BuiltinMPCSystem | null;
  x0: number[];
  control_bounds: Record<string, [number, number]>;
  options: MPCOptions;
}

export interface MPCBuiltin {
  id: BuiltinMPCSystem;
  title: string;
  mode: "tracking" | "economic";
  description: string;
  states: string[];
  controls: string[];
  time_unit: string;
  x0: number[];
  targets: Record<string, number>;
  trackable: string[];
  control_bounds: Record<string, [number, number]>;
  source: string;
}

// ── MPC, split workflow: train a surrogate once, run controllers on it ─────
/** FD / AD = SLSQP with finite-difference / autodiff gradients; CEM, MPPI = batched sampling (built-in only). */
export type MPCControllerId = "fd" | "autodiff" | "CEM" | "MPPI";

export interface MPCController {
  gradient: "autodiff" | "fd" | null;
  optimizer: "SLSQP" | "CEM" | "MPPI";
}

export type MPCSurrogateOptions = Pick<
  MPCOptions,
  "n_train" | "n_val" | "epochs" | "batch_size" | "lr" | "hidden" | "n_layers" | "seed" | "basis" | "use_lr_schedule" | "lpa_n_panels" | "lpa_max_order" | "lpa_nt_seg"
>;

export interface MPCTrainRequest {
  source: "custom" | "builtin";
  system?: SystemSpec | null;
  dt: number;
  builtin?: BuiltinMPCSystem | null;
  label?: string | null;
  options: MPCSurrogateOptions;
}

export interface MPCLoopRequest {
  model_id: string;
  x0: number[];
  targets: Record<string, number>;
  tracking_weights: Record<string, number>;
  control_weights: Record<string, number>;
  control_bounds: Record<string, [number, number]>;
  n_steps: number;
  horizon: number | null;
  plant_solver: string;
  controllers: MPCController[];
}

/** A trained surrogate: a training job's model.json, or the operator a pre-split one-shot run trained. */
export interface MPCSurrogate {
  model_id: string;
  kind: "mpc_surrogate";
  origin: "mpc_train" | "mpc_run";
  source: "custom" | "builtin";
  builtin: BuiltinMPCSystem | null;
  system_name: string;
  label: string;
  spec: SystemSpec | null;
  dt: number | null;
  mode: "tracking" | "economic";
  time_unit: string;
  state_names: string[];
  control_names: string[];
  options: Partial<MPCSurrogateOptions>;
  trained_at: string | null;
  train_seconds: number | null;
  best_val_loss?: number | null;
}

export interface MPCTrainResult {
  kind: "mpc_train";
  model_id: string;
  manifest: MPCSurrogate;
  train_seconds: number;
  history: OperatorTrainResult["history"];
  warnings: string[];
  files: string[];
}

export interface MPCTracking {
  target: number;
  final_error: number;
  final_abs_error: number;
  mean_abs_error: number | null;
}

/** One controller's closed loop. */
export interface MPCRun {
  label: string;
  gradient: "autodiff" | "fd" | null;
  optimizer: "SLSQP" | "CEM" | "MPPI";
  t: Series;
  x: Record<string, Series>;
  u: Record<string, Series>;
  cost: Series;
  tracking: Record<string, MPCTracking>;
  economic: { label: string; final: number; series: Series } | null;
  metadata: Record<string, number | string | boolean>;
  wall_time_sec: number;
}

export interface MPCResult {
  kind: "mpc";
  /** closed loop on a saved surrogate (absent in one-shot results) */
  model_id?: string;
  surrogate?: { label: string; origin: string; options: Partial<MPCSurrogateOptions>; trained_at: string | null; train_seconds: number | null; best_val_loss?: number | null; dt: number | null };
  runs?: MPCRun[];
  adalib_version: string;
  source: "custom" | "builtin";
  system: { name: string; state_names: string[]; control_names: string[]; x0: number[] };
  mode: "tracking" | "economic";
  time_unit: string;
  t: Series;
  x: Record<string, Series>;
  u: Record<string, Series>;
  cost: Series;
  targets: Record<string, number>;
  control_bounds: Record<string, [number, number]>;
  tracking: Record<string, MPCTracking>;
  economic: { label: string; final: number; series: Series } | null;
  options: MPCOptions;
  metadata: Record<string, number | string | boolean>;
  wall_time_sec: number;
  warnings: string[];
  files: string[];
}

export type JobResult = ForwardResult | OperatorTrainResult | OperatorInferResult | InverseResult | MPCResult | MPCTrainResult;

// ── natural-language assistant (/api/assist) ─────────────────────────
export type AssistProvider = "anthropic" | "openai";

export interface AssistMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistForwardRequest {
  prompt: string;
  provider?: AssistProvider;
  current_system?: SystemSpec;
  current_time?: TimeSpan;
  history: AssistMessage[];
}

export interface AssistForwardResponse {
  system: SystemSpec;
  time: TimeSpan;
  reply: string;
  provider: AssistProvider;
  model: string;
  attempts: number;
}

export interface AssistProviderStatus {
  label: string;
  configured: boolean;
  source: "env" | "settings" | null;
  key_hint: string | null;
  model: string;
  default_model: string;
}

export interface AssistStatus {
  provider: AssistProvider | null;
  providers: Record<AssistProvider, AssistProviderStatus>;
  settings_file: string;
}

export interface AssistSettingsUpdate {
  provider: AssistProvider;
  api_key?: string;
  model?: string;
  make_default?: boolean;
}
