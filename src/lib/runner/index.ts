import "server-only";
import { DockerRunner } from "./docker";
import { Judge0Runner } from "./judge0";
import { RunnerUnavailableError, type RunJob, type RunResult, type Runner } from "./types";

/** Tiny async semaphore so a burst of requests cannot flood the execution backend. */
class Semaphore {
  private waiters: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

let cached: Runner | null = null;

export function getRunner(): Runner {
  if (cached) return cached;
  const provider = (process.env.RUNNER_PROVIDER ?? "judge0").toLowerCase();
  const gate = new Semaphore(Number(process.env.RUNNER_MAX_CONCURRENCY ?? 2));
  let inner: Runner;

  if (provider === "docker") {
    if (process.env.NODE_ENV === "production" && process.env.RUNNER_ALLOW_DOCKER !== "1") {
      throw new RunnerUnavailableError("The docker runner is for local use. Configure Judge0 (RUNNER_PROVIDER=judge0) for production, or set RUNNER_ALLOW_DOCKER=1 on a self-hosted machine.");
    }
    inner = new DockerRunner({
      image: process.env.RUNNER_DOCKER_IMAGE ?? "eclipse-temurin:21-jdk",
      gccImage: process.env.RUNNER_DOCKER_GCC_IMAGE ?? "gcc:14",
      parallelism: Number(process.env.RUNNER_DOCKER_PARALLELISM ?? 3),
    });
  } else if (provider === "judge0") {
    const baseUrl = process.env.JUDGE0_URL;
    if (!baseUrl) throw new RunnerUnavailableError("JUDGE0_URL is not configured. See README → Code execution.");
    inner = new Judge0Runner({
      baseUrl,
      authToken: process.env.JUDGE0_AUTH_TOKEN || undefined,
      rapidApiKey: process.env.JUDGE0_RAPIDAPI_KEY || undefined,
      rapidApiHost: process.env.JUDGE0_RAPIDAPI_HOST || undefined,
      languageId: Number(process.env.JUDGE0_JAVA_LANGUAGE_ID ?? 62),
      cppLanguageId: Number(process.env.JUDGE0_CPP_LANGUAGE_ID ?? 54),
      cLanguageId: Number(process.env.JUDGE0_C_LANGUAGE_ID ?? 50),
      maxMemoryKb: Number(process.env.JUDGE0_MAX_MEMORY_KB ?? 512000),
      pollTimeoutMs: Number(process.env.JUDGE0_POLL_TIMEOUT_MS ?? 60000),
    });
  } else if (provider === "manual") {
    throw new RunnerUnavailableError("This site runs in external-runner mode: code is not executed here.");
  } else {
    throw new RunnerUnavailableError(`Unknown RUNNER_PROVIDER "${provider}" (use "judge0", "docker" or "manual").`);
  }

  cached = {
    name: inner.name,
    health: () => inner.health(),
    execute: (jobs: RunJob[]): Promise<RunResult[]> => gate.run(() => inner.execute(jobs)),
  };
  return cached;
}
