import { compareOutput, type CompareMode } from "./compare";
import { composeProgram, mapCompileOutput, validateStudentCode, type ComposeConfig } from "./compose";
import { RESULT_BEGIN, RESULT_END } from "./harness";
import { summarise, type ScoreSummary, type TestStatus } from "./score";
import type { RunResult, Runner } from "../runner/types";

export interface EvalConfig extends ComposeConfig {
  timeLimitMs: number;
  memoryLimitMb: number;
  compareMode: CompareMode;
  floatTolerance: number;
  revealHidden: boolean;
}

export interface EvalTest {
  id: string;
  input: string;
  expectedOutput: string;
  visibility: "public" | "hidden";
  weight: number;
  label?: string | null;
}

/** Full (admin-only) per-test record. */
export interface TestResultFull {
  testId: string;
  visibility: "public" | "hidden";
  status: TestStatus;
  weight: number;
  timeMs: number | null;
  memoryKb: number | null;
  input: string;
  expected: string;
  actual: string | null;
  studentStdout: string;
  stderr: string;
  message?: string;
}

/** What the student may see (hidden test details removed unless the problem allows it). */
export interface TestResultStudent {
  testId: string;
  visibility: "public" | "hidden";
  status: TestStatus;
  timeMs: number | null;
  index: number;
  input?: string;
  expected?: string;
  actual?: string | null;
  studentStdout?: string;
  stderr?: string;
  message?: string;
}

export interface EvalOutput {
  compileOutput: string | null;
  full: TestResultFull[];
  student: TestResultStudent[];
  summary: ScoreSummary;
  execTimeMs: number | null;
  memoryKb: number | null;
  /** Set when the runner itself failed; the verdict is then `system_error`, never a pass. */
  systemError: string | null;
}

const TRUNC = 4000;
const trunc = (s: string, n = TRUNC) => (s.length > n ? s.slice(0, n) + "\n… (truncated)" : s);

/** Pull the harness result (and the student's own prints) out of stdout. */
export function extractFunctionResult(stdout: string): { actual: string; studentStdout: string } | null {
  const b = stdout.lastIndexOf(RESULT_BEGIN);
  if (b === -1) return null;
  const afterBegin = b + RESULT_BEGIN.length;
  const e = stdout.indexOf(RESULT_END, afterBegin);
  if (e === -1) return null;
  const actual = stdout.slice(afterBegin, e).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  const studentStdout = stdout.slice(0, b).replace(/\r?\n$/, "");
  return { actual, studentStdout };
}

function classify(
  cfg: EvalConfig,
  t: EvalTest,
  r: RunResult,
  lineMap: (s: string) => string,
): TestResultFull {
  const base = {
    testId: t.id,
    visibility: t.visibility,
    weight: t.weight,
    timeMs: r.timeMs,
    memoryKb: r.memoryKb,
    input: t.input,
    expected: t.expectedOutput,
    stderr: trunc(lineMap(r.stderr), 2000),
  };
  const empty = { actual: null, studentStdout: "" };
  switch (r.status) {
    case "compile_error":
      return { ...base, ...empty, status: "compile_error" };
    case "time_limit":
      return { ...base, ...empty, studentStdout: trunc(r.stdout), status: "time_limit" };
    case "memory_limit":
      return { ...base, ...empty, status: "memory_limit" };
    case "internal_error":
      return { ...base, ...empty, status: "system_error", message: r.message ?? "Execution service failed" };
    case "runtime_error":
      return { ...base, ...empty, studentStdout: trunc(r.stdout), status: "runtime_error" };
  }
  // status ok
  let actual: string;
  let studentStdout = "";
  if (cfg.executionMode === "function") {
    const ex = extractFunctionResult(r.stdout);
    if (!ex) {
      return { ...base, ...empty, studentStdout: trunc(r.stdout), status: "runtime_error", message: "The program ended without returning a result (did it call System.exit?)." };
    }
    actual = ex.actual;
    studentStdout = ex.studentStdout;
  } else {
    actual = r.stdout;
  }
  const cmp = compareOutput(actual, t.expectedOutput, { mode: cfg.compareMode, floatTolerance: cfg.floatTolerance });
  return {
    ...base,
    actual: trunc(actual),
    studentStdout: trunc(studentStdout),
    status: cmp.ok ? "passed" : "wrong_answer",
    message: cmp.ok ? undefined : cmp.reason,
  };
}

export function toStudentView(full: TestResultFull[], revealHidden: boolean): TestResultStudent[] {
  return full.map((r, index) => {
    const common = { testId: r.testId, visibility: r.visibility, status: r.status, timeMs: r.timeMs, index: index + 1 };
    if (r.visibility === "hidden" && !revealHidden) return common;
    if (r.visibility === "hidden") {
      return { ...common, input: r.input, expected: r.expected, actual: r.actual, message: r.message };
    }
    return {
      ...common,
      input: r.input,
      expected: r.expected,
      actual: r.actual,
      studentStdout: r.studentStdout,
      stderr: r.stderr,
      message: r.message,
    };
  });
}

export interface EvalArgs {
  config: EvalConfig;
  tests: EvalTest[];
  studentCode: string;
  runner: Runner;
}

/**
 * The trusted evaluation pipeline: validate -> compose from stored wrapper -> run each test in
 * the isolated runner -> compare -> score. Any runner failure yields `system_error`.
 */
export async function evaluate({ config, tests, studentCode, runner }: EvalArgs): Promise<EvalOutput> {
  validateStudentCode(studentCode, config); // throws CodeValidationError (caller maps to 400)
  const composed = composeProgram(config, studentCode);
  const lineMap = (s: string) => mapCompileOutput(s, composed.lineOffset, composed.studentLineCount);

  if (tests.length === 0) {
    return { compileOutput: null, full: [], student: [], summary: summarise([]), execTimeMs: null, memoryKb: null, systemError: null };
  }

  let raw: RunResult[];
  try {
    raw = await runner.execute(
      tests.map((t) => ({
        source: composed.source,
        stdin: t.input,
        timeLimitMs: config.timeLimitMs,
        memoryLimitMb: config.memoryLimitMb,
      })),
    );
    if (raw.length !== tests.length) throw new Error("Runner returned an unexpected number of results");
  } catch (e) {
    const message = (e as Error).message;
    const full: TestResultFull[] = tests.map((t) => ({
      testId: t.id, visibility: t.visibility, status: "system_error", weight: t.weight, timeMs: null, memoryKb: null,
      input: t.input, expected: t.expectedOutput, actual: null, studentStdout: "", stderr: "", message,
    }));
    return {
      compileOutput: null,
      full,
      student: toStudentView(full, false).map((r) => ({ ...r, message: "Execution service unavailable" })),
      summary: summarise(full.map((r) => ({ status: r.status, weight: r.weight, visibility: r.visibility }))),
      execTimeMs: null,
      memoryKb: null,
      systemError: message,
    };
  }

  const full = tests.map((t, i) => classify(config, t, raw[i], lineMap));
  const compileFailed = raw.find((r) => r.status === "compile_error");
  const compileOutput = compileFailed ? trunc(lineMap(compileFailed.compileOutput), 6000) : null;
  const sysErr = raw.find((r) => r.status === "internal_error");

  const times = full.map((r) => r.timeMs).filter((x): x is number => x != null);
  const mems = full.map((r) => r.memoryKb).filter((x): x is number => x != null);
  return {
    compileOutput,
    full,
    student: toStudentView(full, config.revealHidden),
    summary: summarise(full.map((r) => ({ status: r.status, weight: r.weight, visibility: r.visibility }))),
    execTimeMs: times.length ? Math.max(...times) : null,
    memoryKb: mems.length ? Math.max(...mems) : null,
    systemError: sysErr ? (sysErr.message ?? "Execution service failed") : null,
  };
}

export interface CustomRunOutput {
  status: TestStatus | "ok";
  compileOutput: string | null;
  /** The program's result (function mode: the returned value; program mode: stdout). */
  output: string | null;
  studentStdout: string;
  stderr: string;
  timeMs: number | null;
  systemError: string | null;
}

/** Run once with arbitrary input and report what happened — no expected output, no grading. */
export async function evaluateCustom(args: { config: EvalConfig; input: string; studentCode: string; runner: Runner }): Promise<CustomRunOutput> {
  validateStudentCode(args.studentCode, args.config);
  const composed = composeProgram(args.config, args.studentCode);
  const lineMap = (s: string) => mapCompileOutput(s, composed.lineOffset, composed.studentLineCount);
  let r: RunResult;
  try {
    [r] = await args.runner.execute([{ source: composed.source, stdin: args.input, timeLimitMs: args.config.timeLimitMs, memoryLimitMb: args.config.memoryLimitMb }]);
  } catch (e) {
    return { status: "system_error", compileOutput: null, output: null, studentStdout: "", stderr: "", timeMs: null, systemError: (e as Error).message };
  }
  const base = { compileOutput: null as string | null, output: null as string | null, studentStdout: "", stderr: trunc(lineMap(r.stderr), 2000), timeMs: r.timeMs, systemError: null as string | null };
  switch (r.status) {
    case "compile_error":
      return { ...base, status: "compile_error", compileOutput: trunc(lineMap(r.compileOutput), 6000) };
    case "time_limit":
      return { ...base, status: "time_limit", studentStdout: trunc(r.stdout) };
    case "memory_limit":
      return { ...base, status: "memory_limit" };
    case "runtime_error":
      return { ...base, status: "runtime_error", studentStdout: trunc(r.stdout) };
    case "internal_error":
      return { ...base, status: "system_error", systemError: r.message ?? "Execution service failed" };
  }
  if (args.config.executionMode === "function") {
    const ex = extractFunctionResult(r.stdout);
    if (!ex) return { ...base, status: "runtime_error", studentStdout: trunc(r.stdout), stderr: "The program ended without returning a result (did it call System.exit?)." };
    return { ...base, status: "ok", output: trunc(ex.actual), studentStdout: trunc(ex.studentStdout) };
  }
  return { ...base, status: "ok", output: trunc(r.stdout) };
}
