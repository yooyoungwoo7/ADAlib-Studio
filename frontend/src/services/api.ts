import type {
  AssistForwardRequest,
  AssistForwardResponse,
  AssistModuleRequest,
  AssistModuleResponse,
  AssistSettingsUpdate,
  AssistStatus,
  Capabilities,
  Example,
  JobResult,
  OperatorBuiltin,
  OperatorManifest,
  OperatorPreset,
  OperatorTrainRequest,
  ForwardRunRequest,
  Health,
  InverseRunRequest,
  JobStatus,
  MPCBuiltin,
  MPCLoopRequest,
  MPCSurrogate,
  MPCTrainRequest,
  SystemSpec,
  ValidateResponse,
} from "../types/api";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function describe(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI/Pydantic validation errors
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) =>
        `${(d.loc ?? []).filter((l) => l !== "body").join(".")}: ${d.msg ?? ""}`)
      .join("; ");
  }
  if (detail && typeof detail === "object") {
    const d = detail as { message?: string; error?: string };
    return d.message ?? d.error ?? JSON.stringify(detail);
  }
  return String(detail);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, describe(detail), detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/api/health"),
  capabilities: () => request<Capabilities>("/api/capabilities"),
  examples: (module?: string) =>
    request<Example[]>(`/api/examples${module ? `?module=${module}` : ""}`),
  validate: (system: SystemSpec) =>
    request<ValidateResponse>("/api/system/validate", { method: "POST", body: JSON.stringify(system) }),
  runForward: (req: ForwardRunRequest) =>
    request<{ job_id: string; status: string }>("/api/forward/run", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  jobs: () => request<JobStatus[]>("/api/jobs?limit=50"),
  job: (id: string) => request<JobStatus>(`/api/jobs/${id}`),
  log: (id: string, offset: number) =>
    request<{ text: string; offset: number }>(`/api/jobs/${id}/log?offset=${offset}`),
  cancel: (id: string) => request<JobStatus>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  deleteJob: (id: string) => request<{ deleted: string }>(`/api/jobs/${id}`, { method: "DELETE" }),
  result: (id: string) => request<JobResult>(`/api/jobs/${id}/result`),
  jobRequest: (id: string) => request<{ kind: string; payload: unknown }>(`/api/jobs/${id}/request`),
  operatorBuiltins: () => request<{ systems: OperatorBuiltin[]; presets: OperatorPreset[] }>("/api/operator/builtins"),
  operatorTrain: (req: OperatorTrainRequest) =>
    request<{ job_id: string; status: string }>("/api/operator/train", { method: "POST", body: JSON.stringify(req) }),
  operatorModels: () => request<OperatorManifest[]>("/api/operator/models"),
  operatorInfer: (req: { model_id: string; x0: number[]; inputs: number[]; reference: boolean }) =>
    request<{ job_id: string; status: string }>("/api/operator/infer", { method: "POST", body: JSON.stringify(req) }),
  runInverse: (req: InverseRunRequest) =>
    request<{ job_id: string; status: string }>("/api/inverse/run", { method: "POST", body: JSON.stringify(req) }),
  mpcBuiltins: () => request<{ systems: MPCBuiltin[]; presets: OperatorPreset[] }>("/api/mpc/builtins"),
  mpcTrain: (req: MPCTrainRequest) =>
    request<{ job_id: string; status: string }>("/api/mpc/train", { method: "POST", body: JSON.stringify(req) }),
  mpcModels: () => request<MPCSurrogate[]>("/api/mpc/models"),
  runMpc: (req: MPCLoopRequest) =>
    request<{ job_id: string; status: string }>("/api/mpc/run", { method: "POST", body: JSON.stringify(req) }),
  assistStatus: () => request<AssistStatus>("/api/assist/status"),
  assistSettings: (upd: AssistSettingsUpdate) =>
    request<AssistStatus>("/api/assist/settings", { method: "PUT", body: JSON.stringify(upd) }),
  assistForward: (req: AssistForwardRequest) =>
    request<AssistForwardResponse>("/api/assist/forward", { method: "POST", body: JSON.stringify(req) }),
  assistModule: (module: "operator" | "inverse" | "mpc", req: AssistModuleRequest) =>
    request<AssistModuleResponse>(`/api/assist/${module}`, { method: "POST", body: JSON.stringify(req) }),
  fileUrl: (id: string, name: string) => `/api/jobs/${id}/files/${name}`,
};
