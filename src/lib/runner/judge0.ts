import { internalError, type RawStatus, type RunJob, type RunResult, type Runner, RunnerUnavailableError } from "./types";

export interface Judge0Config {
  baseUrl: string;
  /** Self-hosted Judge0 `AUTHN_TOKEN` (sent as X-Auth-Token). */
  authToken?: string;
  /** Hosted Judge0 via RapidAPI. */
  rapidApiKey?: string;
  rapidApiHost?: string;
  /** Judge0 language id for Java (62 = OpenJDK 13 on Judge0 CE 1.13.x). */
  languageId: number;
  /** Judge0 server-side cap (MAX_MEMORY_LIMIT, default 512000 KB). */
  maxMemoryKb: number;
  pollTimeoutMs: number;
  fetchImpl?: typeof fetch;
}

const BATCH_SIZE = 20;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

interface J0Result {
  token: string;
  status: { id: number; description: string };
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null;
  memory?: number | null;
}

export class Judge0Runner implements Runner {
  readonly name = "judge0";
  private readonly f: typeof fetch;
  constructor(private readonly cfg: Judge0Config) {
    this.f = cfg.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.rapidApiKey) {
      h["x-rapidapi-key"] = this.cfg.rapidApiKey;
      h["x-rapidapi-host"] = this.cfg.rapidApiHost ?? "judge0-ce.p.rapidapi.com";
    }
    if (this.cfg.authToken) h["X-Auth-Token"] = this.cfg.authToken;
    return h;
  }

  private url(path: string): string {
    return `${this.cfg.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.f(this.url("/languages"), { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { ok: false, detail: `Judge0 responded ${res.status}` };
      const langs = (await res.json()) as { id: number; name: string }[];
      const java = langs.find((l) => l.id === this.cfg.languageId);
      if (!java) return { ok: false, detail: `Judge0 is reachable but language id ${this.cfg.languageId} is not available` };
      return { ok: true, detail: `Judge0 reachable · ${java.name}` };
    } catch (e) {
      return { ok: false, detail: `Judge0 unreachable: ${(e as Error).message}` };
    }
  }

  async execute(jobs: RunJob[]): Promise<RunResult[]> {
    const out: RunResult[] = [];
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      out.push(...(await this.executeBatch(jobs.slice(i, i + BATCH_SIZE))));
    }
    return out;
  }

  private async executeBatch(jobs: RunJob[]): Promise<RunResult[]> {
    const submissions = jobs.map((j) => ({
      language_id: this.cfg.languageId,
      source_code: b64(j.source),
      stdin: b64(j.stdin),
      cpu_time_limit: Math.max(0.5, j.timeLimitMs / 1000),
      wall_time_limit: Math.max(2, (j.timeLimitMs / 1000) * 2 + 2),
      memory_limit: Math.min(this.cfg.maxMemoryKb, Math.max(j.memoryLimitMb * 1024, 128 * 1024)),
    }));

    let tokens: (string | null)[];
    try {
      const res = await this.f(this.url("/submissions/batch?base64_encoded=true"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ submissions }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        throw new RunnerUnavailableError(`Judge0 rejected the submission batch (${res.status}) ${body}`);
      }
      const data = (await res.json()) as { token?: string; error?: string }[];
      tokens = data.map((d) => d.token ?? null);
    } catch (e) {
      if (e instanceof RunnerUnavailableError) throw e;
      throw new RunnerUnavailableError(`Could not reach Judge0: ${(e as Error).message}`);
    }

    const results: (J0Result | null)[] = tokens.map(() => null);
    const pending = new Set(tokens.map((t, i) => (t ? i : -1)).filter((i) => i >= 0));
    const deadline = Date.now() + this.cfg.pollTimeoutMs;
    let delay = 400;

    while (pending.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 2500);
      const idx = [...pending];
      const qs = idx.map((i) => tokens[i]).join(",");
      let data: { submissions: (J0Result | null)[] };
      try {
        const res = await this.f(
          this.url(`/submissions/batch?base64_encoded=true&tokens=${encodeURIComponent(qs)}&fields=token,status,stdout,stderr,compile_output,message,time,memory`),
          { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
        );
        if (!res.ok) continue; // transient; keep polling until the deadline
        data = (await res.json()) as { submissions: (J0Result | null)[] };
      } catch {
        continue;
      }
      data.submissions.forEach((r, k) => {
        if (r && r.status.id > 2) {
          results[idx[k]] = r;
          pending.delete(idx[k]);
        }
      });
    }

    return results.map((r, i) => {
      if (!tokens[i]) return internalError("Judge0 refused this submission");
      if (!r) return internalError("Timed out waiting for Judge0 to finish (job still queued/running)");
      return mapJudge0(r);
    });
  }
}

export function mapJudge0(r: J0Result): RunResult {
  const stdout = unb64(r.stdout);
  const stderr = unb64(r.stderr);
  const compileOutput = unb64(r.compile_output);
  const message = unb64(r.message) || undefined;
  const timeMs = r.time != null ? Math.round(Number(r.time) * 1000) : null;
  const memoryKb = r.memory ?? null;
  const base = { stdout, stderr, compileOutput, timeMs, memoryKb, message };
  const id = r.status.id;
  let status: RawStatus;
  if (id === 3 || id === 4) status = "ok";
  else if (id === 5) status = "time_limit";
  else if (id === 6) status = "compile_error";
  else if (id >= 7 && id <= 12) {
    if (/OutOfMemoryError/.test(stderr)) status = "memory_limit";
    else if (/Error occurred during initialization of VM|Could not reserve enough space/.test(stderr)) {
      return { ...base, status: "internal_error", message: "The Java VM could not start within the configured memory limit (runner misconfiguration)." };
    } else status = "runtime_error";
  } else {
    return { ...base, status: "internal_error", message: message ?? r.status.description };
  }
  return { ...base, status };
}
