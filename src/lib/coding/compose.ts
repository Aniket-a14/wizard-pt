import { EDIT_END, EDIT_START } from "./harness";
import { parseSignature } from "./signature";

export interface ComposeConfig {
  executionMode: "function" | "program";
  editableScope: "method" | "body";
  functionSignature: string | null;
  templatePrefix: string;
  templateSuffix: string;
}

export const MAX_SOURCE_BYTES = 64 * 1024;

export class CodeValidationError extends Error {}

/**
 * Lexically scan Java source and report brace/paren/bracket balance. Ignores braces in
 * comments, string literals, char literals and text blocks. Returns an error message or null.
 */
export function checkBalanced(code: string): string | null {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end === -1) return "Unterminated /* comment";
      i = end + 2;
      continue;
    }
    if (c === '"' && code.startsWith('"""', i)) {
      const end = code.indexOf('"""', i + 3);
      if (end === -1) return 'Unterminated """ text block';
      i = end + 3;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n && code[i] !== quote) {
        if (code[i] === "\\") i++;
        if (code[i] === "\n") return "Unterminated string or character literal";
        i++;
      }
      if (i >= n) return "Unterminated string or character literal";
      i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== pairs[c]) return `Unmatched "${c}"`;
    }
    i++;
  }
  if (stack.length > 0) return `Unclosed "${stack[stack.length - 1]}"`;
  return null;
}

/** Same-length copy of Java source with comments, string/char literals and text blocks blanked (newlines kept). */
function maskJava(code: string): string {
  const out = code.split("");
  const blank = (from: number, to: number) => { for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " "; };
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/") { const e = code.indexOf("\n", i); const end = e === -1 ? n : e; blank(i, end); i = end; continue; }
    if (c === "/" && code[i + 1] === "*") { const e = code.indexOf("*/", i + 2); const end = e === -1 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' && code.startsWith('"""', i)) { const e = code.indexOf('"""', i + 3); const end = e === -1 ? n : e + 3; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

const MAIN_METHOD = /(?:\b(?:public|private|protected|final)\s+)*\bstatic\s+(?:final\s+)?void\s+main\s*\(/g;

/**
 * Function-mode problems run through the platform's own `main`. Students often paste back the whole file
 * they tested elsewhere, including their own `main` (which would clash with the wrapper's). Drop any
 * top-level `static void main(...)` from the student's code, keeping its line count so compile errors
 * still point at the right line. The stored submission itself is never altered.
 */
export function stripStudentMain(code: string): string {
  let result = code;
  let removed = true;
  while (removed) {
    removed = false;
    const masked = maskJava(result);
    MAIN_METHOD.lastIndex = 0;
    for (let hit = MAIN_METHOD.exec(masked); hit; hit = MAIN_METHOD.exec(masked)) {
      // only class-level declarations (brace depth 0 in the student's region)
      let depth = 0;
      for (let k = 0; k < hit.index; k++) depth += masked[k] === "{" ? 1 : masked[k] === "}" ? -1 : 0;
      if (depth !== 0) continue;
      let k = hit.index + hit[0].length;
      let paren = 1;
      while (k < masked.length && paren > 0) { paren += masked[k] === "(" ? 1 : masked[k] === ")" ? -1 : 0; k++; }
      const open = masked.indexOf("{", k);
      if (paren !== 0 || open === -1 || /[;}]/.test(masked.slice(k, open))) continue;
      let braces = 0;
      let end = open;
      for (; end < masked.length; end++) {
        braces += masked[end] === "{" ? 1 : masked[end] === "}" ? -1 : 0;
        if (braces === 0) break;
      }
      if (braces !== 0) continue;
      const cut = result.slice(hit.index, end + 1);
      result = result.slice(0, hit.index) + cut.replace(/[^\n]/g, "") + result.slice(end + 1);
      removed = true;
      break;
    }
  }
  return result;
}

/** Validate what the student is allowed to submit. Throws CodeValidationError with a friendly message. */
export function validateStudentCode(code: string, cfg: Pick<ComposeConfig, "executionMode" | "editableScope" | "functionSignature">): void {
  if (typeof code !== "string" || code.trim() === "") throw new CodeValidationError("Your code is empty.");
  if (new TextEncoder().encode(code).length > MAX_SOURCE_BYTES) {
    throw new CodeValidationError("Your code is too large (limit 64 KB).");
  }
  if (code.includes("\u0000")) throw new CodeValidationError("Your code contains invalid characters.");
  // Student code must not carry the platform's own region markers (would confuse tooling / reviews).
  if (code.includes(EDIT_START) || code.includes(EDIT_END)) {
    throw new CodeValidationError("Remove the STUDENT CODE START/END marker lines from your code.");
  }
  const bal = checkBalanced(code);
  if (cfg.executionMode === "function" && bal) {
    throw new CodeValidationError(`Your code has unbalanced brackets: ${bal}.`);
  }
  if (cfg.executionMode === "program") {
    if (!/\bclass\s+Main\b/.test(code)) {
      throw new CodeValidationError("Your program must define `public class Main` with a main method.");
    }
    if (!/static\s+void\s+main\s*\(/.test(code)) {
      throw new CodeValidationError("Your program needs a `public static void main(String[] args)` method.");
    }
  } else if (cfg.editableScope === "method" && cfg.functionSignature) {
    let name: string | null = null;
    try {
      name = parseSignature(cfg.functionSignature).name;
    } catch {
      name = null;
    }
    if (name && !new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*\\(`).test(code)) {
      throw new CodeValidationError(`Your code must define the method \`${name}\`.`);
    }
  }
}

export interface Composed {
  source: string;
  /** Number of source lines that precede the student's first line (for compile error remapping). */
  lineOffset: number;
  studentLineCount: number;
}

function countLines(s: string): number {
  return s === "" ? 0 : s.split("\n").length - 1;
}

/**
 * Deterministically rebuild the full program from the TRUSTED stored wrapper + student code.
 * No search-and-replace in the template: the wrapper is `prefix` + student + `suffix`.
 */
export function composeProgram(cfg: ComposeConfig, studentCode: string): Composed {
  let code = studentCode.replace(/\r\n/g, "\n");
  if (cfg.executionMode === "function" && cfg.editableScope === "method") code = stripStudentMain(code);
  const studentLineCount = code.split("\n").length;
  if (cfg.executionMode === "program") {
    return { source: code, lineOffset: 0, studentLineCount };
  }
  const prefix = cfg.templatePrefix.replace(/\r\n/g, "\n");
  const suffix = cfg.templateSuffix.replace(/\r\n/g, "\n");
  if (cfg.editableScope === "body" && (cfg.functionSignature ?? "").trim() !== "") {
    const sig = (cfg.functionSignature ?? "").trim();
    const head = `${sig} {\n`;
    const body = code.replace(/\n?$/, "\n");
    return {
      source: `${prefix}${head}${body}}\n${suffix}`,
      lineOffset: countLines(prefix) + 1,
      studentLineCount,
    };
  }
  const body = code.replace(/\n?$/, "\n");
  return { source: `${prefix}${body}${suffix}`, lineOffset: countLines(prefix), studentLineCount };
}

/** Remap `Main.java:LINE:` in javac output to editor line numbers; wrapper-only lines are labelled. */
export function mapCompileOutput(output: string, lineOffset: number, studentLineCount: number): string {
  return output.replace(/Main\.java:(\d+)/g, (_m, num: string) => {
    const line = Number(num) - lineOffset;
    if (line >= 1 && line <= studentLineCount) return `Line ${line}`;
    return "Line (platform wrapper)";
  });
}
