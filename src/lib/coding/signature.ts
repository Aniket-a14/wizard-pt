/**
 * Java method-signature parsing + the typed stdin/stdout serialization contract used by
 * function-mode test harnesses.
 *
 * Supported parameter / return types are intentionally small and fully implemented:
 *   String, int, long, double, boolean, char, int[], long[], double[], boolean[], String[],
 *   plus ArrayList<String> / List<String> as PARAMETERS only
 *
 * Input encoding (one test case `input` string, one *logical value* per parameter, in order):
 *   String                      the raw line (may contain spaces; may be empty)
 *   int/long/double/boolean     one line, trimmed
 *   char                        one line, exactly one character
 *   int[]/long[]/double[]/boolean[]
 *                               one line of space-separated values; an empty line is an empty array
 *   String[]                    a line holding the element count n, then n lines (one element each)
 *   ArrayList<String>/List<String>
 *                               a line holding the element count n, then ONE line of n whitespace-separated
 *                               elements (elements therefore cannot contain spaces)
 *
 * Output encoding (what the harness prints, compared with `expected_output`):
 *   String/int/long/double/boolean/char   the value's string form
 *   primitive arrays                      space-separated values on one line (empty array = empty output)
 *   String[]                              one element per line
 */

export const SUPPORTED_TYPES = [
  "String",
  "int",
  "long",
  "double",
  "boolean",
  "char",
  "int[]",
  "long[]",
  "double[]",
  "boolean[]",
  "String[]",
  "ArrayList<String>",
  "List<String>",
] as const;

const LIST_TYPES: readonly string[] = ["ArrayList<String>", "List<String>"];
export const isListType = (t: string): boolean => LIST_TYPES.includes(t);

export type JavaType = (typeof SUPPORTED_TYPES)[number];

export interface ParsedSignature {
  returnType: JavaType;
  name: string;
  params: { type: JavaType; name: string }[];
  /** Normalised single-line declaration, e.g. `public static String maskCode(String code)`. */
  declaration: string;
}

export class SignatureError extends Error {}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function normaliseType(raw: string): JavaType | null {
  const t = raw.replace(/\s+/g, "").replace(/\[\]/g, "[]");
  return (SUPPORTED_TYPES as readonly string[]).includes(t) ? (t as JavaType) : null;
}

/** Parse e.g. `public static String maskCode(String code)` (optionally ending in `{`). */
export function parseSignature(input: string): ParsedSignature {
  const src = input
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/\{\s*\}?\s*;?$/, "")
    .replace(/;$/, "")
    .trim();

  const m = /^((?:(?:public|private|protected|static|final)\s+)*)([A-Za-z_][\w]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*(?:throws\s+[\w.,\s]+)?$/.exec(src);
  if (!m) throw new SignatureError("Could not read the method signature. Expected something like: public static String name(String arg)");

  const modifiers = m[1].split(/\s+/).filter(Boolean);
  if (!modifiers.includes("static")) {
    throw new SignatureError("The method must be static (e.g. `public static int solve(int n)`).");
  }
  if (modifiers.includes("private")) {
    throw new SignatureError("The method cannot be private.");
  }

  const returnType = normaliseType(m[2]);
  if (!returnType) {
    throw new SignatureError(`Unsupported return type "${m[2].trim()}". Supported: ${SUPPORTED_TYPES.join(", ")}.`);
  }
  if (isListType(returnType)) {
    throw new SignatureError("Lists are supported as parameters only. Return a String[] or a primitive array instead.");
  }
  const name = m[3];

  const params: ParsedSignature["params"] = [];
  const paramSrc = m[4].trim();
  if (paramSrc.length > 0) {
    for (const piece of paramSrc.split(",")) {
      const pm = /^\s*(?:final\s+)?([A-Za-z_][\w]*(?:\s*<[^<>]*>)?(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)\s*$/.exec(piece);
      if (!pm) throw new SignatureError(`Could not read parameter "${piece.trim()}".`);
      const type = normaliseType(pm[1]);
      if (!type) {
        throw new SignatureError(`Unsupported parameter type "${pm[1].trim()}". Supported: ${SUPPORTED_TYPES.join(", ")}.`);
      }
      if (!IDENT.test(pm[2])) throw new SignatureError(`Invalid parameter name "${pm[2]}".`);
      params.push({ type, name: pm[2] });
    }
  }
  const names = new Set<string>();
  for (const p of params) {
    if (names.has(p.name)) throw new SignatureError(`Duplicate parameter name "${p.name}".`);
    names.add(p.name);
  }

  const accessMod = modifiers.includes("public") ? "public " : "";
  const declaration = `${accessMod}static ${returnType} ${name}(${params.map((p) => `${p.type} ${p.name}`).join(", ")})`;
  return { returnType, name, params, declaration };
}

/** Number of input lines a test case for this signature should have (best-effort check). */
export function checkTestInputShape(sig: ParsedSignature, input: string): string | null {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  // A trailing newline from a textarea is not a value.
  if (lines.length > 0 && lines[lines.length - 1] === "" && sig.params.length > 0) lines.pop();
  let i = 0;
  for (const p of sig.params) {
    if (p.type === "String[]") {
      const n = Number((lines[i] ?? "").trim());
      if (!Number.isInteger(n) || n < 0) return `Parameter "${p.name}" (String[]) needs a count line first.`;
      i += 1 + n;
    } else if (isListType(p.type)) {
      const n = Number((lines[i] ?? "").trim());
      if (!Number.isInteger(n) || n < 0) return `Parameter "${p.name}" (${p.type}) needs a count line first.`;
      const items = (lines[i + 1] ?? "").trim() === "" ? 0 : (lines[i + 1] ?? "").trim().split(/\s+/).length;
      if (items !== n) return `Parameter "${p.name}" (${p.type}): the count line says ${n} but the next line has ${items} item${items === 1 ? "" : "s"}.`;
      i += 2;
    } else {
      if (i >= lines.length && p.type !== "String" && !p.type.endsWith("[]")) {
        return `Missing line for parameter "${p.name}" (${p.type}).`;
      }
      i += 1;
    }
  }
  if (i < lines.length && lines.slice(i).some((l) => l.trim() !== "")) {
    return "Input has more lines than the method signature expects.";
  }
  return null;
}
