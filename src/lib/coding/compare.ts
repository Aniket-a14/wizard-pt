export type CompareMode = "exact" | "trim" | "tokens" | "float";

export interface CompareOptions {
  mode: CompareMode;
  floatTolerance?: number;
}

export interface CompareResult {
  ok: boolean;
  /** Short human-readable reason when not ok (never includes hidden expected data). */
  reason?: string;
}

/** Normalise line endings and drop trailing whitespace on each line and trailing blank lines. */
export function normaliseOutput(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Explicit output-comparison policy:
 *  - exact  : case, spacing and line structure must match; only trailing whitespace on a line and
 *             trailing blank lines at the end are ignored.
 *  - trim   : like exact, but leading/trailing whitespace of the whole output is also ignored.
 *  - tokens : whitespace-insensitive; compares whitespace-separated tokens (case-sensitive).
 *  - float  : tokens; numeric tokens match within a relative/absolute tolerance.
 */
export function compareOutput(actual: string, expected: string, opts: CompareOptions): CompareResult {
  switch (opts.mode) {
    case "exact": {
      const a = normaliseOutput(actual);
      const b = normaliseOutput(expected);
      return a === b ? { ok: true } : { ok: false, reason: "Output differs from the expected output" };
    }
    case "trim": {
      const a = normaliseOutput(actual).trim();
      const b = normaliseOutput(expected).trim();
      return a === b ? { ok: true } : { ok: false, reason: "Output differs from the expected output" };
    }
    case "tokens": {
      const a = actual.trim().split(/\s+/).filter(Boolean);
      const b = expected.trim().split(/\s+/).filter(Boolean);
      if (a.length !== b.length) return { ok: false, reason: "Different number of values in the output" };
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { ok: false, reason: "Output differs from the expected output" };
      return { ok: true };
    }
    case "float": {
      const tol = opts.floatTolerance ?? 1e-6;
      const a = actual.trim().split(/\s+/).filter(Boolean);
      const b = expected.trim().split(/\s+/).filter(Boolean);
      if (a.length !== b.length) return { ok: false, reason: "Different number of values in the output" };
      for (let i = 0; i < a.length; i++) {
        if (NUM.test(a[i]) && NUM.test(b[i])) {
          const x = Number(a[i]);
          const y = Number(b[i]);
          if (Math.abs(x - y) > tol * Math.max(1, Math.abs(y))) return { ok: false, reason: "Numeric value outside tolerance" };
        } else if (a[i] !== b[i]) {
          return { ok: false, reason: "Output differs from the expected output" };
        }
      }
      return { ok: true };
    }
  }
}
