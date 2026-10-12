// Glue between the modules and the AI assistant panel (components/assist/AssistPanel.tsx).
import type { AssistAnswer, AssistAsk } from "../components/assist/AssistPanel";
import { api } from "../services/api";

/** Operator / Inverse / MPC: POST /api/assist/{module}. Keys the backend does not return
 *  (read-only context such as "uploaded_file") are kept from the request. */
export const askModule =
  <S extends object>(module: "operator" | "inverse" | "mpc") =>
  async (req: AssistAsk<S>): Promise<AssistAnswer<S>> => {
    const r = await api.assistModule(module, req);
    return { ...r, state: { ...req.state, ...r.state } as S };
  };

/** The project takes the name of a system the assistant created. */
export const renamed = (projectName: string, before: { name: string }, after: { name: string }) =>
  before.name !== after.name ? after.name : projectName;
