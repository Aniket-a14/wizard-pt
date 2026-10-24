import { jsonEqual, sortArrays, tryParseJson, type JVal } from "./json";

export type CompareMode = "exact" | "trim" | "tokens" | "float" | "json" | "unordered" | "unordered_deep";
export const COMPARE_MODES: CompareMode[] = ["exact", "trim", "tokens", "float", "json", "unordered", "unordered_deep"];

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
 *  - json   : both sides are read as values (JSON, or values separated by spaces/lines) and compared
 *             structurally, so spacing like "[1, 2]" vs "[1,2]" does not matter. Array ORDER matters.
 *  - unordered       : like json, but the order of the outermost list is ignored ("return in any order").
 *  - unordered_deep  : like json, but the order of every list at every level is ignored.
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
    case "json":
    case "unordered":
    case "unordered_deep": {
      let a = toValue(actual);
      let b = toValue(expected);
      if (opts.mode !== "json") {
        const deep = opts.mode === "unordered_deep";
        a = sortArrays(a, deep);
        b = sortArrays(b, deep);
      }
      return jsonEqual(a, b, opts.floatTolerance ?? 1e-6) ? { ok: true } : { ok: false, reason: "Output differs from the expected output" };
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

/**
 * Read an output as a value: JSON when it parses (compact or spaced), otherwise the values it holds —
 * one per line for multi-line text, one per whitespace-separated token for a single line.
 */
export function toValue(text: string): JVal {
  const t = text.replace(/\r\n?/g, "\n").trim();
  const j = tryParseJson(t);
  if (j !== undefined) return j;
  const lines = t.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length > 1) return lines;
  return t.split(/\s+/).filter(Boolean);
}
