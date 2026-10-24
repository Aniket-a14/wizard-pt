import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Judge0Runner } from "@/lib/runner/judge0";
import { RunnerUnavailableError } from "@/lib/runner/types";
import { evaluate } from "@/lib/coding/evaluate";
import { buildFunctionTemplate } from "@/lib/coding/harness";
import { parseSignature } from "@/lib/coding/signature";

/** A tiny fake of the Judge0 REST protocol: batch submit → tokens → batch poll (queued → done). */
let server: Server;
let base = "";
let mode: "ok" | "down" | "never-finishes" = "ok";
const jobs = new Map<string, { polls: number; stdin: string; source: string; langId: number }>();
const seenHeaders: IncomingMessage["headers"][] = [];

const b64 = (s: string) => Buffer.from(s).toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

beforeAll(async () => {
  server = createServer((req, res) => {
    seenHeaders.push(req.headers);
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url!, base);
      res.setHeader("Content-Type", "application/json");
      if (mode === "down") { res.statusCode = 503; return void res.end(JSON.stringify({ error: "down" })); }
      if (req.method === "GET" && url.pathname === "/languages") return void res.end(JSON.stringify([{ id: 91, name: "Java (JDK 17.0.6)" }]));
      if (req.method === "POST" && url.pathname === "/submissions/batch") {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const out = body.submissions.map((s: { source_code: string; stdin: string; language_id: number }) => {
          const token = Math.random().toString(36).slice(2);
          jobs.set(token, { polls: 0, stdin: unb64(s.stdin), source: unb64(s.source_code), langId: s.language_id });
          return { token };
        });
        res.statusCode = 201;
        return void res.end(JSON.stringify(out));
      }
      if (req.method === "GET" && url.pathname === "/submissions/batch") {
        const tokens = url.searchParams.get("tokens")!.split(",");
        const subs = tokens.map((t) => {
          const j = jobs.get(t)!;
          j.polls++;
          if (mode === "never-finishes" || j.polls < 2) return { token: t, status: { id: j.polls < 2 ? 1 : 2, description: "In Queue" } };
          const src = j.source;
          if (src.includes("COMPILE_ERR")) return { token: t, status: { id: 6, description: "Compilation Error" }, compile_output: b64("Main.java:9: error: ';' expected") };
          if (src.includes("INFINITE")) return { token: t, status: { id: 5, description: "Time Limit Exceeded" }, time: "2.0", memory: 1000 };
          if (src.includes("THROWS")) return { token: t, status: { id: 11, description: "NZEC" }, stderr: b64("Exception in thread main java.lang.RuntimeException"), time: "0.1", memory: 1000 };
          const text = j.stdin.toUpperCase();
          return { token: t, status: { id: 3, description: "Accepted" }, stdout: b64(`\n@@WPT_RESULT_BEGIN@@\n${text}\n@@WPT_RESULT_END@@\n`), time: "0.05", memory: 24000 };
        });
        return void res.end(JSON.stringify({ submissions: subs }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const runner = (extra = {}) => new Judge0Runner({ baseUrl: base, languageId: 91, maxMemoryKb: 512000, pollTimeoutMs: 4000, authToken: "tok", ...extra });
const job = (source: string, stdin = "x") => ({ source, stdin, timeLimitMs: 2000, memoryLimitMb: 256 });

describe("Judge0 client protocol", () => {
  it("submits a batch, polls through queue states, decodes base64 results", async () => {
    mode = "ok";
    const r = await runner().execute([job("// ok", "hello"), job("// ok", "world")]);
    expect(r.map((x) => x.status)).toEqual(["ok", "ok"]);
    expect(r[0].stdout).toContain("HELLO");
    expect(r[0].timeMs).toBe(50);
    expect(r[0].memoryKb).toBe(24000);
    expect([...jobs.values()].every((j) => j.langId === 91)).toBe(true);
  });

  it("sends the auth token / RapidAPI headers and never leaks them in results", async () => {
    mode = "ok";
    seenHeaders.length = 0;
    await runner({ authToken: "secret-tok" }).execute([job("// ok")]);
    expect(seenHeaders.some((h) => h["x-auth-token"] === "secret-tok")).toBe(true);
    seenHeaders.length = 0;
    await runner({ authToken: undefined, rapidApiKey: "rk", rapidApiHost: "judge0-ce.p.rapidapi.com" }).execute([job("// ok")]);
    expect(seenHeaders.some((h) => h["x-rapidapi-key"] === "rk")).toBe(true);
  });

  it("maps compile errors, time limits and runtime errors", async () => {
    mode = "ok";
    const r = await runner().execute([job("COMPILE_ERR"), job("INFINITE"), job("THROWS")]);
    expect(r.map((x) => x.status)).toEqual(["compile_error", "time_limit", "runtime_error"]);
    expect(r[0].compileOutput).toContain("';' expected");
  });

  it("splits more than 20 jobs into several batches", async () => {
    mode = "ok";
    const r = await runner().execute(Array.from({ length: 45 }, (_, i) => job("// ok", `v${i}`)));
    expect(r).toHaveLength(45);
    expect(r[44].stdout).toContain("V44");
  });

  it("an unavailable service raises RunnerUnavailableError (never a pass)", async () => {
    mode = "down";
    await expect(runner().execute([job("// ok")])).rejects.toBeInstanceOf(RunnerUnavailableError);
    expect((await runner().health()).ok).toBe(false);
  });

  it("jobs that never finish become internal_error, not Accepted", async () => {
    mode = "never-finishes";
    const r = await runner({ pollTimeoutMs: 1500 }).execute([job("// ok")]);
    expect(r[0].status).toBe("internal_error");
  });

  it("health check verifies the Java language id", async () => {
    mode = "ok";
    expect((await runner().health()).ok).toBe(true);
    expect((await runner({ languageId: 62 }).health()).ok).toBe(false);
  });

  it("works through the full evaluation pipeline and a down runner gives system_error", async () => {
    const sig = parseSignature("public static String up(String s)");
    const tpl = buildFunctionTemplate(sig);
    const config = { executionMode: "function" as const, editableScope: "method" as const, functionSignature: sig.declaration, templatePrefix: tpl.prefix, templateSuffix: tpl.suffix, timeLimitMs: 2000, memoryLimitMb: 256, compareMode: "exact" as const, floatTolerance: 1e-6, revealHidden: false };
    const tests = [{ id: "1", input: "abc", expectedOutput: "ABC", visibility: "public" as const, weight: 1 }];
    mode = "ok";
    const ok = await evaluate({ config, tests, studentCode: "public static String up(String s) { return s; }", runner: runner() });
    expect(ok.summary.verdict).toBe("accepted"); // fake judge uppercases stdin, matching expected
    mode = "down";
    const bad = await evaluate({ config, tests, studentCode: "public static String up(String s) { return s; }", runner: runner() });
    expect(bad.summary.verdict).toBe("system_error");
    expect(bad.systemError).toBeTruthy();
  });
});
