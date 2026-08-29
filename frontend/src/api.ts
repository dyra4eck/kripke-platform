import type { KripkeModel } from "./types/kripke";

/** One state of a counterexample trace, with the full valuation. */
export interface TraceState {
  index: number;
  state: string | null;
  loop_start: boolean;
  values: Record<string, boolean | number | string>;
}

export interface Verdict {
  formula: string;
  holds: boolean;
  trace: TraceState[];
}

export interface CheckResult {
  total: boolean | null;
  all_hold: boolean;
  verdicts: Verdict[];
}

export interface PipelineResult {
  ok: boolean;
  stage: "validate" | "convert" | "check";
  errors: string[];
  duration_s: number;
  smv?: string;
  check?: CheckResult;
}

/** A rejected model, i.e. anything the backend answered with 4xx/5xx. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly result: PipelineResult | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Validation messages, ready to show next to the graph. */
  get errors(): string[] {
    return this.result?.errors ?? [this.message];
  }
}

const BASE = "/api";

async function post(path: string, model: KripkeModel): Promise<PipelineResult> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // FastAPI wraps HTTPException payloads in `detail`.
    const detail = body?.detail ?? null;
    const result: PipelineResult | null =
      detail && typeof detail === "object" && "stage" in detail ? detail : null;
    throw new ApiError(
      response.status,
      result,
      result?.errors?.[0] ?? `Запрос завершился с кодом ${response.status}`,
    );
  }

  return body as PipelineResult;
}

/** Validate and generate SMV, without running the model checker. */
export const convert = (model: KripkeModel) => post("/convert", model);

/** Validate, generate SMV and model-check. */
export const verify = (model: KripkeModel) => post("/verify", model);

export async function health(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`);
    return r.ok;
  } catch {
    return false;
  }
}
