export type TestStatus =
  | "passed"
  | "wrong_answer"
  | "runtime_error"
  | "time_limit"
  | "memory_limit"
  | "compile_error"
  | "system_error"
  | "not_run";

export type Verdict =
  | "accepted"
  | "partial"
  | "wrong_answer"
  | "compile_error"
  | "runtime_error"
  | "time_limit"
  | "memory_limit"
  | "system_error"
  | "manual";

export interface TestOutcome {
  status: TestStatus;
  weight: number;
  visibility: "public" | "hidden";
}

export interface ScoreSummary {
  verdict: Verdict;
  scorePct: number;
  passedPublic: number;
  totalPublic: number;
  passedHidden: number;
  totalHidden: number;
}

const FAILURE_PRIORITY: TestStatus[] = ["compile_error", "time_limit", "memory_limit", "runtime_error", "wrong_answer"];

/**
 * Weighted score + verdict. A system_error (runner unavailable etc.) NEVER counts as passed
 * and forces a `system_error` verdict so a failed runner can't yield a false Accepted.
 */
export function summarise(outcomes: TestOutcome[]): ScoreSummary {
  const total = outcomes.length;
  const pub = outcomes.filter((o) => o.visibility === "public");
  const hid = outcomes.filter((o) => o.visibility === "hidden");
  const passedPublic = pub.filter((o) => o.status === "passed").length;
  const passedHidden = hid.filter((o) => o.status === "passed").length;

  const base = { passedPublic, totalPublic: pub.length, passedHidden, totalHidden: hid.length };
  if (total === 0) return { verdict: "manual", scorePct: 0, ...base };

  if (outcomes.some((o) => o.status === "system_error" || o.status === "not_run")) {
    const w = outcomes.reduce((s, o) => s + o.weight, 0);
    const got = outcomes.filter((o) => o.status === "passed").reduce((s, o) => s + o.weight, 0);
    return { verdict: "system_error", scorePct: w > 0 ? round2((got / w) * 100) : 0, ...base };
  }

  const totalWeight = outcomes.reduce((s, o) => s + o.weight, 0);
  const gotWeight = outcomes.filter((o) => o.status === "passed").reduce((s, o) => s + o.weight, 0);
  const scorePct = totalWeight > 0 ? round2((gotWeight / totalWeight) * 100) : 0;

  if (outcomes.every((o) => o.status === "compile_error")) return { verdict: "compile_error", scorePct: 0, ...base };
  if (outcomes.every((o) => o.status === "passed")) return { verdict: "accepted", scorePct: 100, ...base };
  if (gotWeight > 0) return { verdict: "partial", scorePct, ...base };

  for (const s of FAILURE_PRIORITY) {
    if (outcomes.some((o) => o.status === s)) return { verdict: s as Verdict, scorePct, ...base };
  }
  return { verdict: "wrong_answer", scorePct, ...base };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  accepted: "Accepted",
  partial: "Partially Accepted",
  wrong_answer: "Wrong Answer",
  compile_error: "Compilation Error",
  runtime_error: "Runtime Error",
  time_limit: "Time Limit Exceeded",
  memory_limit: "Memory Limit Exceeded",
  system_error: "Evaluation Unavailable",
  manual: "Awaiting Manual Review",
};
