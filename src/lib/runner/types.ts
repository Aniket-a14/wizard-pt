export interface RunJob {
  source: string;
  stdin: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}

export type RawStatus =
  | "ok"
  | "compile_error"
  | "runtime_error"
  | "time_limit"
  | "memory_limit"
  /** The runner itself failed (network, queue, unsupported runtime). Never treated as a pass. */
  | "internal_error";

export interface RunResult {
  status: RawStatus;
  stdout: string;
  stderr: string;
  compileOutput: string;
  timeMs: number | null;
  memoryKb: number | null;
  message?: string;
}

export interface Runner {
  readonly name: string;
  /** Compile + run every job. Result order matches job order. Must throw or return internal_error on infra failure. */
  execute(jobs: RunJob[]): Promise<RunResult[]>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

export class RunnerUnavailableError extends Error {}

export function internalError(message: string): RunResult {
  return { status: "internal_error", stdout: "", stderr: "", compileOutput: "", timeMs: null, memoryKb: null, message };
}
