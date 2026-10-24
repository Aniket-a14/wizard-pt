import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { internalError, type RunJob, type RunResult, type Runner } from "./types";

/**
 * Local / self-hosted sandbox: every compile and every run happens in a throw-away Docker
 * container with no network, a read-only root filesystem, dropped capabilities, and hard
 * memory / CPU / process limits. The web process only launches `docker` with a fixed argv
 * (no shell, no string interpolation); student code never executes inside it.
 *
 * Intended for local development and single-host self-hosting. Production on Vercel
 * should use Judge0 (see README).
 */
export interface DockerRunnerConfig {
  image: string;
  parallelism: number;
  dockerBin?: string;
}

const MAX_OUTPUT = 256 * 1024;

function run(
  bin: string,
  args: string[],
  opts: { input?: string; timeoutMs: number; containerName?: string },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; elapsedMs: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const kill = () => {
      timedOut = true;
      if (opts.containerName) execFile(bin, ["kill", opts.containerName], () => undefined);
      child.kill("SIGKILL");
    };
    const timer = setTimeout(kill, opts.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8");
      else if (!timedOut) kill();
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut, elapsedMs: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, elapsedMs: Date.now() - started });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.input ?? "");
  });
}

const HARDENING = [
  "--rm",
  "--network", "none",
  "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges",
  "--read-only",
  "--pids-limit", "128",
  "--user", "65534:65534",
  "--cpus", "1",
];

export class DockerRunner implements Runner {
  readonly name = "docker";
  private readonly bin: string;
  constructor(private readonly cfg: DockerRunnerConfig) {
    this.bin = cfg.dockerBin ?? "docker";
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    const r = await run(this.bin, ["image", "inspect", this.cfg.image, "--format", "{{.Id}}"], { timeoutMs: 15_000 });
    if (r.code !== 0) {
      return { ok: false, detail: `Docker image ${this.cfg.image} is not available (run: docker pull ${this.cfg.image})` };
    }
    return { ok: true, detail: `Docker sandbox ready · ${this.cfg.image}` };
  }

  async execute(jobs: RunJob[]): Promise<RunResult[]> {
    if (jobs.length === 0) return [];
    // Compile each distinct source once.
    const bySource = new Map<string, { dir: string; compile: Promise<RunResult | null> }>();
    const cleanups: string[] = [];
    try {
      for (const job of jobs) {
        const key = createHash("sha256").update(job.source).digest("hex");
        if (bySource.has(key)) continue;
        const dir = await mkdtemp(join(tmpdir(), "wpt-"));
        cleanups.push(dir);
        await chmod(dir, 0o777);
        await writeFile(join(dir, "Main.java"), job.source, "utf8");
        bySource.set(key, { dir, compile: this.compile(dir) });
      }

      const results: RunResult[] = new Array(jobs.length);
      let next = 0;
      const worker = async () => {
        for (;;) {
          const i = next++;
          if (i >= jobs.length) return;
          const job = jobs[i];
          const key = createHash("sha256").update(job.source).digest("hex");
          const entry = bySource.get(key)!;
          const compileFailure = await entry.compile;
          results[i] = compileFailure ?? (await this.runOne(entry.dir, job));
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, this.cfg.parallelism) }, worker));
      return results;
    } finally {
      await Promise.all(cleanups.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)));
    }
  }

  private async compile(dir: string): Promise<RunResult | null> {
    const name = `wpt-c-${randomBytes(6).toString("hex")}`;
    const r = await run(
      this.bin,
      [
        "run", "--name", name, ...HARDENING,
        "--memory", "768m", "--memory-swap", "768m",
        "--tmpfs", "/tmp:rw,exec,size=128m",
        "-v", `${dir}:/work:rw`, "-w", "/work",
        this.cfg.image,
        "javac", "-J-Xmx384m", "-J-XX:+UseSerialGC", "-encoding", "UTF-8", "-proc:none", "Main.java",
      ],
      { timeoutMs: 30_000, containerName: name },
    );
    if (r.timedOut) return internalError("Compilation timed out");
    if (r.code === 0) return null;
    if (r.code === -1 || /Unable to find image|Cannot connect to the Docker daemon|docker: /i.test(r.stderr) && !/error:/.test(r.stderr)) {
      return internalError(`Docker failure: ${r.stderr.slice(0, 300)}`);
    }
    return { status: "compile_error", stdout: "", stderr: "", compileOutput: (r.stderr || r.stdout).slice(0, 8000), timeMs: null, memoryKb: null };
  }

  private async runOne(dir: string, job: RunJob): Promise<RunResult> {
    const name = `wpt-r-${randomBytes(6).toString("hex")}`;
    const heap = Math.max(32, job.memoryLimitMb - 32);
    const timeoutSec = Math.ceil((job.timeLimitMs + 800) / 1000);
    const r = await run(
      this.bin,
      [
        "run", "-i", "--name", name, ...HARDENING,
        "--memory", `${job.memoryLimitMb + 160}m`, "--memory-swap", `${job.memoryLimitMb + 160}m`,
        "--tmpfs", "/tmp:rw,size=16m",
        "-v", `${dir}:/work:ro`, "-w", "/work",
        this.cfg.image,
        "timeout", "-s", "KILL", String(timeoutSec),
        "java", `-Xmx${heap}m`, "-Xss1m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-Xshare:auto", "-cp", "/work", "Main",
      ],
      { input: job.stdin, timeoutMs: job.timeLimitMs + 6000, containerName: name },
    );
    const base = { stdout: r.stdout, stderr: r.stderr.slice(0, 8000), compileOutput: "", timeMs: r.elapsedMs, memoryKb: null as number | null };
    if (r.code === -1 && !r.timedOut) return internalError(`Docker failure: ${r.stderr.slice(0, 300)}`);
    if (r.timedOut || r.code === 124 || r.code === 137) {
      // 137 within the time budget means the container was OOM-killed.
      if (!r.timedOut && r.elapsedMs < job.timeLimitMs) return { ...base, status: "memory_limit" };
      return { ...base, status: "time_limit" };
    }
    if (/OutOfMemoryError/.test(r.stderr)) return { ...base, status: "memory_limit" };
    if (r.code !== 0) return { ...base, status: "runtime_error" };
    return { ...base, status: "ok" };
  }
}
