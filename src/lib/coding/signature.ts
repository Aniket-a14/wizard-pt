/**
 * Java method-signature parsing + the typed stdin/stdout serialization contract used by
 * function-mode test harnesses. The type grammar lives in ./types (any nesting of arrays, lists,
 * sets, maps, ListNode/TreeNode). How each kind of value is WRITTEN in a test case:
 *
 *   one line                  String (the text itself), int, long, double, boolean, char, Integer, ...
 *   int[] long[] double[] boolean[] short[] byte[] float[] Integer[] ...
 *                             one line of space-separated values; an empty line is an empty array
 *   char[]                    one line holding the characters
 *   String[]                  a line holding the element count n, then n lines (one element each)
 *   List/Set<scalar>          a line holding the element count n, then ONE line of n whitespace-separated
 *                             items (so items cannot contain spaces)
 *   int[][] char[][] ...      a line holding the row count, then one line per row
 *                             (space-separated values; for char[][] the row's characters with no spaces)
 *   anything else             one line of JSON: List<List<Integer>>, int[][][], Map<String,Integer>, ...
 *   ListNode                  JSON array of values: [1,2,3]            ([] = empty list)
 *   TreeNode                  JSON level-order array with nulls: [3,9,20,null,null,15,7]   ([] = empty tree)
 *
 * What the harness prints (compared with `expected_output`) follows the same shapes, except that
 * String[] / List<String> print one element per line, 2-D arrays print one row per line, and Sets and
 * Map keys are printed in sorted order so the output is deterministic. A `void` method's result is its
 * first parameter after the call (for in-place problems).
 */
import {
  SignatureError, describeInput, describeOutput, encodingOf, isMutable, parseTypeAt, tokenize, typeText,
  SUPPORTED_TYPES_HELP, type JType, type Token,
} from "./types";
import { tryParseJson, isArr } from "./json";

export { SignatureError, SUPPORTED_TYPES_HELP };
export { parseType, typeText, encodingOf, usesJsonOutput, type JType } from "./types";

export interface ParsedSignature {
  /** Canonical Java text of the return type ("void" for in-place problems). */
  returnType: string;
  name: string;
  params: { type: string; name: string }[];
  /** Normalised single-line declaration, e.g. `public static String maskCode(String code)`. */
  declaration: string;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MODIFIERS = ["public", "private", "protected", "static", "final"];

/** Parse e.g. `public static String maskCode(String code)` (optionally ending in `{`). */
export function parseSignature(input: string): ParsedSignature {
  const src = input
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/\{\s*\}?\s*;?$/, "")
    .replace(/;$/, "")
    .trim();

  const hint = "Expected something like: public static String name(String arg)";
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch (e) {
    if (e instanceof SignatureError) throw new SignatureError(`Could not read the method signature. ${e.message}`);
    throw e;
  }

  let i = 0;
  const modifiers: string[] = [];
  while (tokens[i]?.t === "id" && MODIFIERS.includes(tokens[i].v)) modifiers.push(tokens[i++].v);
  if (!modifiers.includes("static")) throw new SignatureError("The method must be static (e.g. `public static int solve(int n)`).");
  if (modifiers.includes("private")) throw new SignatureError("The method cannot be private.");

  if (tokens[i]?.t !== "id") throw new SignatureError(`Could not read the method signature. ${hint}`);
  const ret = parseTypeAt(tokens, i);
  i = ret.next;
  if (tokens[i]?.t !== "id") throw new SignatureError(`Could not read the method signature. ${hint}`);
  const name = tokens[i++].v;
  if (!IDENT.test(name)) throw new SignatureError(`Invalid method name "${name}".`);
  if (tokens[i]?.t !== "(") throw new SignatureError(`Could not read the method signature. ${hint}`);
  i++;

  const params: { type: string; name: string; j: JType }[] = [];
  if (tokens[i]?.t !== ")") {
    for (;;) {
      if (tokens[i]?.t === "id" && tokens[i].v === "final") i++;
      if (tokens[i]?.t !== "id") throw new SignatureError(`Could not read parameter ${params.length + 1}. ${hint}`);
      const p = parseTypeAt(tokens, i);
      i = p.next;
      if (p.type.k === "void") throw new SignatureError("A parameter cannot be void.");
      const pn = tokens[i];
      if (pn?.t !== "id" || !IDENT.test(pn.v)) throw new SignatureError(`Could not read the name of parameter ${params.length + 1}.`);
      i++;
      params.push({ type: typeText(p.type), name: pn.v, j: p.type });
      if (tokens[i]?.t === ",") { i++; continue; }
      if (tokens[i]?.t === ")") break;
      throw new SignatureError(`Could not read the parameter list. ${hint}`);
    }
  }
  i++; // ")"
  if (i < tokens.length && !(tokens[i].t === "id" && tokens[i].v === "throws")) {
    throw new SignatureError(`Unexpected "${tokens[i].v}" after the parameter list.`);
  }

  const names = new Set<string>();
  for (const p of params) {
    if (names.has(p.name)) throw new SignatureError(`Duplicate parameter name "${p.name}".`);
    names.add(p.name);
  }

  const returnType = typeText(ret.type);
  if (ret.type.k === "void" && !(params[0] && isMutable(params[0].j))) {
    throw new SignatureError("A void method must take an array, list, set, map or node as its first parameter: that parameter's final state is the result.");
  }

  const accessMod = modifiers.includes("public") ? "public " : "";
  const declaration = `${accessMod}static ${returnType} ${name}(${params.map((p) => `${p.type} ${p.name}`).join(", ")})`;
  return { returnType, name, params: params.map(({ type, name: n }) => ({ type, name: n })), declaration };
}

/** The type of a parsed parameter / return value. */
export function paramTypes(sig: ParsedSignature): { name: string; j: JType }[] {
  return sig.params.map((p) => ({ name: p.name, j: reparse(p.type) }));
}
export function returnJType(sig: ParsedSignature): JType {
  return reparse(sig.returnType);
}
function reparse(text: string): JType {
  const r = parseTypeAt(tokenize(text), 0);
  return r.type;
}

/** What the admin needs to know to write test cases for this signature. */
export function describeSignatureFormat(sig: ParsedSignature): { inputs: string[]; output: string } {
  return {
    inputs: paramTypes(sig).map((p) => describeInput(p.name, p.j)),
    output: describeOutput(returnJType(sig)),
  };
}

/** Best-effort check that a test input has the shape the signature expects. Returns a message or null. */
export function checkTestInputShape(sig: ParsedSignature, input: string): string | null {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  // A trailing newline from a textarea is not a value.
  if (lines.length > 0 && lines[lines.length - 1] === "" && sig.params.length > 0) lines.pop();
  let i = 0;
  const count = (p: { name: string; type: string }): number | string => {
    const n = Number((lines[i] ?? "").trim());
    return Number.isInteger(n) && n >= 0 ? n : `Parameter "${p.name}" (${p.type}) needs a count line first.`;
  };
  for (const p of paramTypes(sig)) {
    const meta = { name: p.name, type: typeText(p.j) };
    switch (encodingOf(p.j)) {
      case "strings": {
        const n = count(meta);
        if (typeof n === "string") return n;
        i += 1 + n;
        break;
      }
      case "items": {
        const n = count(meta);
        if (typeof n === "string") return n;
        const row = (lines[i + 1] ?? "").trim();
        const items = row === "" ? 0 : row.split(/\s+/).length;
        if (items !== n) return `Parameter "${p.name}" (${meta.type}): the count line says ${n} but the next line has ${items} item${items === 1 ? "" : "s"}.`;
        i += 2;
        break;
      }
      case "grid": {
        const n = count(meta);
        if (typeof n === "string") return n;
        const have = Math.max(0, lines.length - i - 1);
        if (have < n) return `Parameter "${p.name}" (${meta.type}): the count line says ${n} rows but only ${have} follow.`;
        i += 1 + n;
        break;
      }
      case "json": {
        const text = (lines[i] ?? "").trim();
        if (text === "") return `Missing line for parameter "${p.name}" (${meta.type}): it must be one line of JSON.`;
        const v = tryParseJson(text);
        if (v === undefined) return `Parameter "${p.name}" (${meta.type}) must be valid JSON on one line.`;
        if (p.j.k === "node" && v !== null && !isArr(v)) return `Parameter "${p.name}" (${meta.type}) must be a JSON array.`;
        i += 1;
        break;
      }
      case "array1":
      case "chars":
        i += 1;
        break;
      case "line":
        if (i >= lines.length && !(p.j.k === "scalar" && p.j.name === "String")) return `Missing line for parameter "${p.name}" (${meta.type}).`;
        i += 1;
        break;
    }
  }
  if (i < lines.length && lines.slice(i).some((l) => l.trim() !== "")) {
    return "Input has more lines than the method signature expects.";
  }
  return null;
}
