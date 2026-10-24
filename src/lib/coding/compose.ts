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
  const code = studentCode.replace(/\r\n/g, "\n");
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
