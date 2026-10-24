/**
 * The Java type model used by function-mode problems.
 *
 * A signature may use any type built from this grammar:
 *
 *   scalar   int long double boolean char short byte float String
 *            Integer Long Double Boolean Character Short Byte Float
 *   array    T[]  T[][] ...                      (T = scalar, array or node; no arrays of generics)
 *   list     List<T> ArrayList<T> LinkedList<T>
 *   set      Set<T> HashSet<T> LinkedHashSet<T> TreeSet<T>
 *   map      Map<K,V> HashMap<K,V> LinkedHashMap<K,V> TreeMap<K,V>   (K = String, Integer, Long, Character)
 *   node     ListNode  TreeNode                  (LeetCode-style classes, provided by the platform)
 *   void     return type only: the result is the first parameter after the call (in-place problems)
 *
 * Inside generics only reference types are legal in Java, so write List<Integer>, never List<int>.
 */

export class SignatureError extends Error {}

export type ScalarName =
  | "int" | "long" | "double" | "boolean" | "char" | "short" | "byte" | "float" | "String"
  | "Integer" | "Long" | "Double" | "Boolean" | "Character" | "Short" | "Byte" | "Float";

export type JType =
  | { k: "scalar"; name: ScalarName }
  | { k: "array"; of: JType }
  | { k: "list"; impl: "List" | "ArrayList" | "LinkedList"; of: JType }
  | { k: "set"; impl: "Set" | "HashSet" | "LinkedHashSet" | "TreeSet"; of: JType }
  | { k: "map"; impl: "Map" | "HashMap" | "LinkedHashMap" | "TreeMap"; key: JType; value: JType }
  | { k: "node"; name: "ListNode" | "TreeNode" }
  | { k: "void" };

const PRIMITIVES = ["int", "long", "double", "boolean", "char", "short", "byte", "float"] as const;
const WRAPPERS = ["Integer", "Long", "Double", "Boolean", "Character", "Short", "Byte", "Float"] as const;
const SCALARS: readonly string[] = [...PRIMITIVES, ...WRAPPERS, "String"];
const LISTS = ["List", "ArrayList", "LinkedList"] as const;
const SETS = ["Set", "HashSet", "LinkedHashSet", "TreeSet"] as const;
const MAPS = ["Map", "HashMap", "LinkedHashMap", "TreeMap"] as const;
const MAP_KEYS = ["String", "Integer", "Long", "Character"];
const MAX_DEPTH = 4;

export const SUPPORTED_TYPES_HELP =
  "primitives and their wrappers, String, arrays of any depth (int[][], char[][], String[]…), " +
  "List/ArrayList/LinkedList<T>, Set/HashSet/LinkedHashSet/TreeSet<T>, Map/HashMap/LinkedHashMap/TreeMap<K,V> (K = String, Integer, Long or Character), ListNode and TreeNode";

// ------------------------------------------------------------------ tokenizer

export type Token = { t: "id" | "<" | ">" | "," | "[" | "]" | "(" | ")" | "..." | "?"; v: string };

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith("...", i)) { out.push({ t: "...", v: "..." }); i += 3; continue; }
    if ("<>,[]()".includes(c)) { out.push({ t: c as Token["t"], v: c }); i++; continue; }
    const m = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(src.slice(i));
    if (!m) throw new SignatureError(`Unexpected character "${c}" in the signature.`);
    out.push({ t: "id", v: m[0] });
    i += m[0].length;
  }
  return out;
}

// ------------------------------------------------------------------ type parser

/** Parse one type starting at `pos`; returns the type and the next position. */
export function parseTypeAt(tokens: Token[], pos: number, depth = 0): { type: JType; next: number } {
  if (depth > MAX_DEPTH) throw new SignatureError(`Types nested more than ${MAX_DEPTH} levels deep are not supported.`);
  const tk = tokens[pos];
  if (!tk || tk.t !== "id") throw new SignatureError("Expected a type.");
  const raw = tk.v.replace(/^java\.(?:util|lang)\./, "");
  let i = pos + 1;
  let base: JType;

  const generic = (): JType[] => {
    if (tokens[i]?.t !== "<") throw new SignatureError(`"${raw}" needs type arguments, e.g. ${raw}<Integer>.`);
    i++;
    const args: JType[] = [];
    for (;;) {
      const r = parseTypeAt(tokens, i, depth + 1);
      args.push(r.type);
      i = r.next;
      if (tokens[i]?.t === ",") { i++; continue; }
      if (tokens[i]?.t === ">") { i++; break; }
      throw new SignatureError(`Could not read the type arguments of "${raw}".`);
    }
    return args;
  };
  const noGenerics = () => {
    if (tokens[i]?.t === "<") throw new SignatureError(`"${raw}" does not take type arguments.`);
  };
  const element = (t: JType): JType => {
    if (t.k === "scalar" && (PRIMITIVES as readonly string[]).includes(t.name)) {
      const boxed = WRAPPERS[PRIMITIVES.indexOf(t.name as (typeof PRIMITIVES)[number])];
      throw new SignatureError(`Use ${boxed}, not ${t.name}, inside ${raw}<…>.`);
    }
    if (t.k === "void") throw new SignatureError("void is not a valid type argument.");
    return t;
  };

  if (raw === "void") {
    noGenerics();
    base = { k: "void" };
  } else if (SCALARS.includes(raw)) {
    noGenerics();
    base = { k: "scalar", name: raw as ScalarName };
  } else if (raw === "ListNode" || raw === "TreeNode") {
    noGenerics();
    base = { k: "node", name: raw };
  } else if ((LISTS as readonly string[]).includes(raw)) {
    const a = generic();
    if (a.length !== 1) throw new SignatureError(`${raw} takes exactly one type argument.`);
    base = { k: "list", impl: raw as (typeof LISTS)[number], of: element(a[0]) };
  } else if ((SETS as readonly string[]).includes(raw)) {
    const a = generic();
    if (a.length !== 1) throw new SignatureError(`${raw} takes exactly one type argument.`);
    base = { k: "set", impl: raw as (typeof SETS)[number], of: element(a[0]) };
  } else if ((MAPS as readonly string[]).includes(raw)) {
    const a = generic();
    if (a.length !== 2) throw new SignatureError(`${raw} takes two type arguments, e.g. ${raw}<String, Integer>.`);
    const key = element(a[0]);
    if (key.k !== "scalar" || !MAP_KEYS.includes(key.name)) {
      throw new SignatureError(`Map keys must be String, Integer, Long or Character (got ${typeText(key)}).`);
    }
    base = { k: "map", impl: raw as (typeof MAPS)[number], key, value: element(a[1]) };
  } else {
    throw new SignatureError(`Unsupported type "${raw}". Supported: ${SUPPORTED_TYPES_HELP}.`);
  }

  // array suffixes: [] [] ...  (or a trailing "..." for varargs, treated as one dimension)
  for (;;) {
    if (tokens[i]?.t === "[" && tokens[i + 1]?.t === "]") {
      i += 2;
      base = wrapArray(base, raw);
    } else if (tokens[i]?.t === "...") {
      i += 1;
      base = wrapArray(base, raw);
    } else break;
  }
  return { type: base, next: i };
}

function wrapArray(of: JType, raw: string): JType {
  if (of.k === "void") throw new SignatureError("void[] is not a type.");
  if (of.k === "list" || of.k === "set" || of.k === "map") {
    throw new SignatureError(`Arrays of ${raw}<…> are not supported. Use a List of ${raw}s (e.g. List<${raw}<…>>) or an array of arrays.`);
  }
  return { k: "array", of };
}

export function parseType(text: string): JType {
  const tokens = tokenize(text);
  const r = parseTypeAt(tokens, 0);
  if (r.next !== tokens.length) throw new SignatureError(`Could not read the type "${text.trim()}".`);
  return r.type;
}

// ------------------------------------------------------------------ canonical text

/** Canonical Java source text of a type (what appears in generated code and in the editor). */
export function typeText(t: JType): string {
  switch (t.k) {
    case "scalar": return t.name;
    case "array": return `${typeText(t.of)}[]`;
    case "list": return `${t.impl}<${typeText(t.of)}>`;
    case "set": return `${t.impl}<${typeText(t.of)}>`;
    case "map": return `${t.impl}<${typeText(t.key)}, ${typeText(t.value)}>`;
    case "node": return t.name;
    case "void": return "void";
  }
}

export const isPrimitive = (t: JType): boolean => t.k === "scalar" && (PRIMITIVES as readonly string[]).includes(t.name);
export const isScalar = (t: JType): t is Extract<JType, { k: "scalar" }> => t.k === "scalar";
export const isReference = (t: JType): boolean => t.k !== "void" && !(t.k === "scalar" && (t.name !== "String" && !(WRAPPERS as readonly string[]).includes(t.name)));
/** A reference type the method can mutate in place (so `void` problems can report it). */
export const isMutable = (t: JType): boolean => t.k === "array" || t.k === "list" || t.k === "set" || t.k === "map" || t.k === "node";

// ------------------------------------------------------------------ stdin / stdout encodings

/**
 * How a value is written in a test case.
 *   line      one line (String, int, char, Integer, ...)
 *   array1    one line of space-separated values (int[], long[], double[], boolean[], short[], byte[], float[], wrapper[])
 *   chars     one line holding the characters (char[])
 *   strings   a count line, then one line per element (String[])
 *   items     a count line, then ONE line of whitespace-separated items (List/Set of a scalar)
 *   grid      a row-count line, then one line per row (T[][] of scalars; char[][] rows are plain strings)
 *   json      one line of JSON (everything else)
 */
export type Encoding = "line" | "array1" | "chars" | "strings" | "items" | "grid" | "json";

const isNumericOrBool = (name: string) => name !== "String" && name !== "char" && name !== "Character";

export function encodingOf(t: JType): Encoding {
  switch (t.k) {
    case "scalar": return "line";
    case "array": {
      const e = t.of;
      if (e.k === "scalar") {
        if (e.name === "String") return "strings";
        if (e.name === "char") return "chars";
        return "array1";
      }
      if (e.k === "array" && e.of.k === "scalar") return "grid";
      return "json";
    }
    case "list":
    case "set":
      return t.of.k === "scalar" ? "items" : "json";
    default:
      return "json";
  }
}

/** JSON-encoded results are compared structurally by default (spacing in the expected output then does not matter). */
export const usesJsonOutput = (t: JType): boolean => t.k !== "void" && encodingOf(t) === "json";

/** Human-readable description of how a value of this type is written in a test input. */
export function describeInput(name: string, t: JType): string {
  const e = encodingOf(t);
  switch (e) {
    case "line": return t.k === "scalar" && t.name === "String" ? `${name}: one line (the text itself)` : `${name}: one line`;
    case "array1": return `${name}: one line of space-separated values (empty line = empty array)`;
    case "chars": return `${name}: one line holding the characters`;
    case "strings": return `${name}: a count line, then one line per element`;
    case "items": return `${name}: a count line, then one line of space-separated items`;
    case "grid": {
      const rows = t.k === "array" && t.of.k === "array" && t.of.of.k === "scalar" && (t.of.of.name === "char") ? "one line per row, the row's characters with no spaces" : "one line per row of space-separated values";
      return `${name}: a row-count line, then ${rows}`;
    }
    case "json":
      return t.k === "node"
        ? t.name === "ListNode" ? `${name}: one line, a JSON array of the node values, e.g. [1,2,3] ([] for an empty list)` : `${name}: one line, the tree in level order as JSON with nulls, e.g. [3,9,20,null,null,15,7] ([] for an empty tree)`
        : `${name}: one line of JSON, e.g. ${jsonExample(t)}`;
  }
}

function jsonExample(t: JType): string {
  switch (t.k) {
    case "scalar": return t.name === "String" || t.name === "char" || t.name === "Character" ? '"a"' : t.name === "boolean" || t.name === "Boolean" ? "true" : "1";
    case "array":
    case "list":
    case "set": {
      const inner = jsonExample(t.of);
      return `[${inner},${inner}]`;
    }
    case "map": return `{"a":${jsonExample(t.value)}}`;
    default: return "[]";
  }
}

export function describeOutput(t: JType): string {
  if (t.k === "void") return "the first parameter after the method has run (written the way that parameter's type is written in the output)";
  const e = encodingOf(t);
  switch (e) {
    case "line": return "the value as text";
    case "array1": return "space-separated values on one line";
    case "chars": return "the characters on one line";
    case "strings": return "one element per line";
    case "items": return t.k === "list" || t.k === "set" ? (t.of.k === "scalar" && t.of.name === "String" ? "one item per line (sets are printed sorted)" : "space-separated items on one line (sets are printed sorted)") : "";
    case "grid": return "one row per line";
    case "json": return t.k === "node" ? "JSON, as described for inputs" : "compact JSON on one line (maps sorted by key, sets sorted)";
  }
}

export { isNumericOrBool };
