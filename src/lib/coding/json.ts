/**
 * Tiny JSON reader used for test inputs/outputs. Unlike JSON.parse it keeps numbers as their
 * original text, so 64-bit integers never lose precision when two outputs are compared.
 */

export type JVal = null | boolean | string | { n: string } | JVal[] | { o: [string, JVal][] };

export class JsonError extends Error {}

export function parseJson(text: string): JVal {
  let i = 0;
  const s = text;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const fail = (m: string): never => { throw new JsonError(`${m} (at character ${i + 1})`); };

  function str(): string {
    if (s[i] !== '"') fail("Expected a string");
    i++;
    let out = "";
    while (i < s.length && s[i] !== '"') {
      if (s[i] === "\\") {
        i++;
        const c = s[i++];
        if (c === "u") {
          const hex = s.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Bad \\u escape");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
          if (!(c in map)) fail("Bad escape");
          out += map[c];
        }
      } else out += s[i++];
    }
    if (s[i] !== '"') fail("Unterminated string");
    i++;
    return out;
  }

  function val(): JVal {
    ws();
    const c = s[i];
    if (c === undefined) return fail("Unexpected end");
    if (c === "[") {
      i++;
      const arr: JVal[] = [];
      ws();
      if (s[i] === "]") { i++; return arr; }
      for (;;) {
        arr.push(val());
        ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return arr; }
        fail("Expected , or ]");
      }
    }
    if (c === "{") {
      i++;
      const o: [string, JVal][] = [];
      ws();
      if (s[i] === "}") { i++; return { o }; }
      for (;;) {
        ws();
        const k = str();
        ws();
        if (s[i] !== ":") fail("Expected :");
        i++;
        o.push([k, val()]);
        ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "}") { i++; return { o }; }
        fail("Expected , or }");
      }
    }
    if (c === '"') return str();
    const m = /^[^\s,\]}]+/.exec(s.slice(i));
    if (!m) return fail("Unexpected character");
    i += m[0].length;
    if (m[0] === "null") return null;
    if (m[0] === "true") return true;
    if (m[0] === "false") return false;
    if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(m[0])) fail(`Not a valid JSON value: ${m[0]}`);
    return { n: m[0] };
  }

  const v = val();
  ws();
  if (i !== s.length) fail("Unexpected data after the value");
  return v;
}

export function tryParseJson(text: string): JVal | undefined {
  try {
    return parseJson(text);
  } catch {
    return undefined;
  }
}

export const isArr = (v: JVal): v is JVal[] => Array.isArray(v);
export const isNum = (v: JVal): v is { n: string } => typeof v === "object" && v !== null && !Array.isArray(v) && "n" in v;
export const isObj = (v: JVal): v is { o: [string, JVal][] } => typeof v === "object" && v !== null && !Array.isArray(v) && "o" in v;

/** Canonical compact text of a value (object keys sorted), used for ordering and equality. */
export function canon(v: JVal): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (isNum(v)) return /[.eE]/.test(v.n) ? v.n : BigInt(v.n).toString();
  if (isArr(v)) return `[${v.map(canon).join(",")}]`;
  return `{${[...v.o].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${JSON.stringify(k)}:${canon(x)}`).join(",")}}`;
}

const byCanon = (a: JVal, b: JVal) => { const x = canon(a), y = canon(b); return x < y ? -1 : x > y ? 1 : 0; };

/** Sort every array (`deep`) or only the outermost one, by canonical text — for "any order" answers. */
export function sortArrays(v: JVal, deep: boolean, top = true): JVal {
  if (isArr(v)) {
    const items = deep ? v.map((e) => sortArrays(e, true, false)) : v;
    return deep || top ? [...items].sort(byCanon) : items;
  }
  if (isObj(v)) return deep ? { o: v.o.map(([k, x]) => [k, sortArrays(x, true, false)] as [string, JVal]) } : v;
  return v;
}

const FLOATY = /[.eE]/;

/** Structural equality; numbers match exactly, or within `tol` when either side is written as a decimal. */
export function jsonEqual(a: JVal, b: JVal, tol = 0): boolean {
  if (isNum(a) && isNum(b)) {
    if (a.n === b.n) return true;
    if (!FLOATY.test(a.n) && !FLOATY.test(b.n)) return BigInt(a.n) === BigInt(b.n);
    const x = Number(a.n), y = Number(b.n);
    return Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));
  }
  if (isArr(a) && isArr(b)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i], tol));
  if (isObj(a) && isObj(b)) {
    if (a.o.length !== b.o.length) return false;
    const m = new Map(b.o);
    return a.o.every(([k, x]) => m.has(k) && jsonEqual(x, m.get(k)!, tol));
  }
  return a === b;
}

/** Unordered equality uses value equality, including numeric notation and tolerance. */
export function unorderedJsonEqual(a: JVal, b: JVal, tol = 0, deep = false, top = true): boolean {
  const equal = (x: JVal, y: JVal) => unorderedJsonEqual(x, y, tol, deep, false);
  if (isArr(a) && isArr(b)) {
    if (a.length !== b.length) return false;
    if (!deep && !top) return a.every((x, i) => equal(x, b[i]));
    const scalar = (x: JVal) => !isArr(x) && !isObj(x);
    if (a.every(scalar) && b.every(scalar)) {
      // Numeric tolerance intervals are ordered, so sorted scalar lists can be matched in O(n log n).
      const compare = (x: JVal, y: JVal) => {
        if (isNum(x) && isNum(y)) {
          if (!FLOATY.test(x.n) && !FLOATY.test(y.n)) {
            const l = BigInt(x.n), r = BigInt(y.n);
            return l < r ? -1 : l > r ? 1 : 0;
          }
          const l = Number(x.n), r = Number(y.n);
          return l < r ? -1 : l > r ? 1 : 0;
        }
        const kind = (v: JVal) => isNum(v) ? "number" : v === null ? "null" : typeof v;
        const kx = kind(x), ky = kind(y);
        return kx < ky ? -1 : kx > ky ? 1 : byCanon(x, y);
      };
      const left = [...a].sort(compare), right = [...b].sort(compare);
      return left.every((x, i) => equal(x, right[i]));
    }
    const hasDecimal = (v: JVal): boolean => isNum(v) ? FLOATY.test(v.n)
      : isArr(v) ? v.some(hasDecimal) : isObj(v) ? v.o.some(([, value]) => hasDecimal(value)) : false;
    if (!hasDecimal(a) && !hasDecimal(b)) {
      // Exact compound values retain the normal O(n log n) path, even for large outputs.
      return jsonEqual(sortArrays(a, deep), sortArrays(b, deep), tol);
    }
    // Structured values can have overlapping tolerance matches. Find a complete matching rather
    // than greedily consuming the first equal item (which can leave another item unmatched).
    const candidates = a.map((x) => b.flatMap((y, j) => equal(x, y) ? [j] : []));
    const matched = new Array<number>(b.length).fill(-1);
    const visit = (i: number, seen: Set<number>): boolean => {
      for (const j of candidates[i]) {
        if (seen.has(j)) continue;
        seen.add(j);
        if (matched[j] === -1 || visit(matched[j], seen)) { matched[j] = i; return true; }
      }
      return false;
    };
    return a.every((_, i) => visit(i, new Set()));
  }
  if (isObj(a) && isObj(b)) {
    if (a.o.length !== b.o.length) return false;
    const other = new Map(b.o);
    return a.o.every(([key, value]) => other.has(key) && equal(value, other.get(key)!));
  }
  return jsonEqual(a, b, tol);
}
