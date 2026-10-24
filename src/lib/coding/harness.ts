import { encodingOf, isPrimitive, typeText, type JType, type ScalarName } from "./types";
import { paramTypes, returnJType, type ParsedSignature } from "./signature";

/** Markers around the student-editable region of generated / pasted boilerplate. */
export const EDIT_START = "// ==== STUDENT CODE START ====";
export const EDIT_END = "// ==== STUDENT CODE END ====";

/** The harness brackets the returned value with these so student `System.out` noise cannot corrupt it. */
export const RESULT_BEGIN = "@@WPT_RESULT_BEGIN@@";
export const RESULT_END = "@@WPT_RESULT_END@@";

const IMPORTS = [
  "java.io.*",
  "java.math.*",
  "java.util.*",
  "java.util.function.*",
  "java.util.stream.*",
];

export interface FunctionTemplate {
  /** Trusted code placed before the student's code. */
  prefix: string;
  /** Trusted code placed after the student's code. */
  suffix: string;
  /** Starter shown when the student edits the whole method (including its signature). */
  starterMethod: string;
  /** Starter shown when only the body is editable. */
  starterBody: string;
}

// ---------------------------------------------------------------- Java source snippets
// (String.raw keeps the Java backslashes exactly as written.)

const LEGACY_HELPERS: Record<string, string> = {
  char: String.raw`    private static char __wptChar(String s) { return s.isEmpty() ? (char) 0 : s.charAt(0); }`,
  ints: String.raw`    private static int[] __wptInts(String s) {
        s = s.trim();
        if (s.isEmpty()) return new int[0];
        String[] p = s.split("\\s+");
        int[] r = new int[p.length];
        for (int i = 0; i < p.length; i++) r[i] = Integer.parseInt(p[i]);
        return r;
    }`,
  longs: String.raw`    private static long[] __wptLongs(String s) {
        s = s.trim();
        if (s.isEmpty()) return new long[0];
        String[] p = s.split("\\s+");
        long[] r = new long[p.length];
        for (int i = 0; i < p.length; i++) r[i] = Long.parseLong(p[i]);
        return r;
    }`,
  doubles: String.raw`    private static double[] __wptDoubles(String s) {
        s = s.trim();
        if (s.isEmpty()) return new double[0];
        String[] p = s.split("\\s+");
        double[] r = new double[p.length];
        for (int i = 0; i < p.length; i++) r[i] = Double.parseDouble(p[i]);
        return r;
    }`,
  bools: String.raw`    private static boolean[] __wptBools(String s) {
        s = s.trim();
        if (s.isEmpty()) return new boolean[0];
        String[] p = s.split("\\s+");
        boolean[] r = new boolean[p.length];
        for (int i = 0; i < p.length; i++) r[i] = Boolean.parseBoolean(p[i]);
        return r;
    }`,
  strings: String.raw`    private static String[] __wptStrings(BufferedReader in) throws IOException {
        int n = Integer.parseInt(__wptReadLine(in).trim());
        String[] r = new String[n];
        for (int i = 0; i < n; i++) r[i] = __wptReadLine(in);
        return r;
    }`,
};

const JSON_RUNTIME = String.raw`    private static final class __WptNum {
        final String raw;
        __WptNum(String raw) { this.raw = raw; }
    }

    /** Minimal JSON reader: arrays -> List, objects -> Map, numbers -> __WptNum, plus String / Boolean / null. */
    private static final class __WptJ {
        private final String s;
        private int i;
        private __WptJ(String s) { this.s = s; }
        static Object parse(String text) {
            __WptJ p = new __WptJ(text);
            try {
                p.ws();
                Object v = p.val();
                p.ws();
                if (p.i != text.length()) throw new IllegalStateException("unexpected data after the JSON value");
                return v;
            } catch (IndexOutOfBoundsException e) {
                throw new IllegalStateException("the JSON input ended unexpectedly");
            }
        }
        private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
        private Object val() {
            char c = s.charAt(i);
            if (c == '[') {
                i++;
                ArrayList<Object> l = new ArrayList<>();
                ws();
                if (s.charAt(i) == ']') { i++; return l; }
                while (true) {
                    ws();
                    l.add(val());
                    ws();
                    char d = s.charAt(i++);
                    if (d == ']') return l;
                    if (d != ',') throw new IllegalStateException("expected , or ] in the JSON input");
                }
            }
            if (c == '{') {
                i++;
                LinkedHashMap<String, Object> m = new LinkedHashMap<>();
                ws();
                if (s.charAt(i) == '}') { i++; return m; }
                while (true) {
                    ws();
                    String k = str();
                    ws();
                    if (s.charAt(i++) != ':') throw new IllegalStateException("expected : in the JSON input");
                    ws();
                    m.put(k, val());
                    ws();
                    char d = s.charAt(i++);
                    if (d == '}') return m;
                    if (d != ',') throw new IllegalStateException("expected , or } in the JSON input");
                }
            }
            if (c == '"') return str();
            int st = i;
            while (i < s.length() && ",]} \t\r\n".indexOf(s.charAt(i)) < 0) i++;
            String t = s.substring(st, i);
            if (t.equals("null")) return null;
            if (t.equals("true")) return Boolean.TRUE;
            if (t.equals("false")) return Boolean.FALSE;
            return new __WptNum(t);
        }
        private String str() {
            if (s.charAt(i) != '"') throw new IllegalStateException("expected a string in the JSON input");
            i++;
            StringBuilder b = new StringBuilder();
            while (s.charAt(i) != '"') {
                char c = s.charAt(i++);
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n': b.append('\n'); break;
                        case 't': b.append('\t'); break;
                        case 'r': b.append('\r'); break;
                        case 'b': b.append('\b'); break;
                        case 'f': b.append('\f'); break;
                        case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                        default: b.append(e);
                    }
                } else b.append(c);
            }
            i++;
            return b.toString();
        }
    }

    private static String __wptRaw(Object o) {
        if (o instanceof __WptNum) return ((__WptNum) o).raw;
        if (o instanceof String) return (String) o;
        throw new IllegalStateException("expected a number in the JSON input but found " + o);
    }
    private static String __wptStr(Object o) {
        if (o == null) return null;
        if (o instanceof String) return (String) o;
        if (o instanceof __WptNum) return ((__WptNum) o).raw;
        return String.valueOf(o);
    }
    private static char __wptCh(Object o) {
        String s = __wptStr(o);
        if (s == null || s.length() != 1) throw new IllegalStateException("expected a one-character string in the JSON input");
        return s.charAt(0);
    }
    private static String __wptQ(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }
    private static String __wptNumJson(Double d) {
        if (d == null) return "null";
        if (d.isNaN() || d.isInfinite()) return "\"" + d + "\"";
        return String.valueOf(d);
    }`;

const LISTNODE_CLASS = String.raw`    static class ListNode {
        int val;
        ListNode next;
        ListNode() {}
        ListNode(int val) { this.val = val; }
        ListNode(int val, ListNode next) { this.val = val; this.next = next; }
    }`;

const TREENODE_CLASS = String.raw`    static class TreeNode {
        int val;
        TreeNode left;
        TreeNode right;
        TreeNode() {}
        TreeNode(int val) { this.val = val; }
        TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; }
    }`;

// ---------------------------------------------------------------- code generation

const scalarName = (t: JType): ScalarName | null => (t.k === "scalar" ? t.name : null);

/** Java expression turning the String token `tok` into a value of scalar type `name`. */
function fromToken(name: ScalarName, tok: string): string {
  const boxed: Record<string, string> = { Integer: "Integer", Long: "Long", Double: "Double", Boolean: "Boolean", Short: "Short", Byte: "Byte", Float: "Float" };
  switch (name) {
    case "int": return `Integer.parseInt(${tok})`;
    case "long": return `Long.parseLong(${tok})`;
    case "double": return `Double.parseDouble(${tok})`;
    case "boolean": return `Boolean.parseBoolean(${tok})`;
    case "short": return `Short.parseShort(${tok})`;
    case "byte": return `Byte.parseByte(${tok})`;
    case "float": return `Float.parseFloat(${tok})`;
    case "char": return `${tok}.charAt(0)`;
    case "String": return tok;
    case "Character": return `("null".equals(${tok}) ? null : Character.valueOf(${tok}.charAt(0)))`;
    default: return `("null".equals(${tok}) ? null : ${boxed[name]}.valueOf(${tok}))`;
  }
}

/** Java expression turning the parsed-JSON object `o` into a value of scalar type `name`. */
function fromJson(name: ScalarName, o: string): string {
  const num: Record<string, [string, string]> = {
    int: ["Integer", "parseInt"], long: ["Long", "parseLong"], double: ["Double", "parseDouble"],
    short: ["Short", "parseShort"], byte: ["Byte", "parseByte"], float: ["Float", "parseFloat"],
  };
  const boxedNum: Record<string, string> = { Integer: "Integer", Long: "Long", Double: "Double", Short: "Short", Byte: "Byte", Float: "Float" };
  if (name in num) return `${num[name][0]}.${num[name][1]}(__wptRaw(${o}))`;
  if (name in boxedNum) return `(${o} == null ? null : ${boxedNum[name]}.valueOf(__wptRaw(${o})))`;
  switch (name) {
    case "boolean": return `((Boolean) ${o}).booleanValue()`;
    case "Boolean": return `((Boolean) ${o})`;
    case "char": return `__wptCh(${o})`;
    case "Character": return `(${o} == null ? null : Character.valueOf(__wptCh(${o})))`;
    default: return `__wptStr(${o})`;
  }
}

/** Java expression writing scalar `v` as a JSON value. */
function toJson(name: ScalarName, v: string): string {
  switch (name) {
    case "double": return `__wptNumJson(Double.valueOf(${v}))`;
    case "Double": return `__wptNumJson(${v})`;
    case "char": return `__wptQ(String.valueOf(${v}))`;
    case "Character": return `(${v} == null ? "null" : __wptQ(String.valueOf(${v})))`;
    case "String": return `(${v} == null ? "null" : __wptQ(${v}))`;
    default: return `String.valueOf(${v})`;
  }
}

const CONCRETE: Record<string, string> = {
  List: "ArrayList", ArrayList: "ArrayList", LinkedList: "LinkedList",
  Set: "LinkedHashSet", HashSet: "HashSet", LinkedHashSet: "LinkedHashSet", TreeSet: "TreeSet",
  Map: "LinkedHashMap", HashMap: "HashMap", LinkedHashMap: "LinkedHashMap", TreeMap: "TreeMap",
};

function usesNode(t: JType, name: "ListNode" | "TreeNode"): boolean {
  switch (t.k) {
    case "node": return t.name === name;
    case "array": case "list": case "set": return usesNode(t.of, name);
    case "map": return usesNode(t.key, name) || usesNode(t.value, name);
    default: return false;
  }
}

class Gen {
  private helpers = new Map<string, string>();
  private memo = new Map<string, string>();
  private n = 0;
  needsJson = false;

  add(key: string, src: string) {
    if (!this.helpers.has(key)) this.helpers.set(key, src);
  }
  all(): string[] {
    return [...this.helpers.values()];
  }
  private name(prefix: string, t: JType): string {
    const key = `${prefix}:${typeText(t)}`;
    let n = this.memo.get(key);
    if (!n) {
      n = `${prefix}${this.n++}`;
      this.memo.set(key, n);
      return n + "\u0000new"; // marker: caller must build the body
    }
    return n;
  }

  // ---- JSON -> value
  conv(t: JType, o: string): string {
    const sn = scalarName(t);
    if (sn) return fromJson(sn, o);
    this.needsJson = true;
    return `${this.convMethod(t)}(${o})`;
  }
  private convMethod(t: JType): string {
    const raw = this.name("__wptCv", t);
    if (!raw.endsWith("\u0000new")) return raw;
    const name = raw.slice(0, -4);
    const T = typeText(t);
    let body: string;
    switch (t.k) {
      case "array": {
        const make = T.replace("[]", "[l.size()]");
        body = `if (o == null) return null; List<?> l = (List<?>) o; ${T} r = new ${make}; for (int i = 0; i < r.length; i++) r[i] = ${this.conv(t.of, "l.get(i)")}; return r;`;
        break;
      }
      case "list":
      case "set":
        body = `if (o == null) return null; ${CONCRETE[t.impl]}<${typeText(t.of)}> r = new ${CONCRETE[t.impl]}<>(); for (Object e : (List<?>) o) r.add(${this.conv(t.of, "e")}); return r;`;
        break;
      case "map": {
        const kn = t.key.k === "scalar" ? t.key.name : "String";
        const k = kn === "String" ? "(String) e.getKey()" : kn === "Character" ? "Character.valueOf(((String) e.getKey()).charAt(0))" : `${kn}.valueOf((String) e.getKey())`;
        body = `if (o == null) return null; ${CONCRETE[t.impl]}<${typeText(t.key)}, ${typeText(t.value)}> r = new ${CONCRETE[t.impl]}<>(); for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) r.put(${k}, ${this.conv(t.value, "e.getValue()")}); return r;`;
        break;
      }
      case "node":
        body = t.name === "ListNode"
          ? `if (o == null) return null; ListNode head = null; ListNode tail = null; for (Object e : (List<?>) o) { ListNode nd = new ListNode(Integer.parseInt(__wptRaw(e))); if (head == null) head = nd; else tail.next = nd; tail = nd; } return head;`
          : `if (o == null) return null; List<?> l = (List<?>) o; if (l.isEmpty() || l.get(0) == null) return null; TreeNode root = new TreeNode(Integer.parseInt(__wptRaw(l.get(0)))); ArrayDeque<TreeNode> q = new ArrayDeque<>(); q.add(root); int i = 1; while (!q.isEmpty() && i < l.size()) { TreeNode cur = q.poll(); if (i < l.size() && l.get(i) != null) { cur.left = new TreeNode(Integer.parseInt(__wptRaw(l.get(i)))); q.add(cur.left); } i++; if (i < l.size() && l.get(i) != null) { cur.right = new TreeNode(Integer.parseInt(__wptRaw(l.get(i)))); q.add(cur.right); } i++; } return root;`;
        break;
      default:
        throw new Error("unreachable");
    }
    this.add(name, `    private static ${T} ${name}(Object o) { ${body} }`);
    return name;
  }

  // ---- value -> JSON
  fmt(t: JType, v: string): string {
    this.needsJson = true; // the JSON writers share the quoting helpers in the JSON runtime
    const sn = scalarName(t);
    if (sn) return toJson(sn, v);
    return `${this.fmtMethod(t)}(${v})`;
  }
  private fmtMethod(t: JType): string {
    const raw = this.name("__wptFm", t);
    if (!raw.endsWith("\u0000new")) return raw;
    const name = raw.slice(0, -4);
    const T = typeText(t);
    let body: string;
    switch (t.k) {
      case "array":
        body = `if (v == null) return "null"; StringBuilder sb = new StringBuilder("["); for (int i = 0; i < v.length; i++) { if (i > 0) sb.append(','); sb.append(${this.fmt(t.of, "v[i]")}); } return sb.append(']').toString();`;
        break;
      case "list":
        body = `if (v == null) return "null"; StringBuilder sb = new StringBuilder("["); boolean first = true; for (${typeText(t.of)} e : v) { if (!first) sb.append(','); first = false; sb.append(${this.fmt(t.of, "e")}); } return sb.append(']').toString();`;
        break;
      case "set": {
        const E = typeText(t.of);
        body = t.of.k === "scalar"
          ? `if (v == null) return "null"; ArrayList<${E}> l = new ArrayList<>(v); Collections.sort(l); StringBuilder sb = new StringBuilder("["); for (int i = 0; i < l.size(); i++) { if (i > 0) sb.append(','); sb.append(${this.fmt(t.of, "l.get(i)")}); } return sb.append(']').toString();`
          : `if (v == null) return "null"; ArrayList<String> parts = new ArrayList<>(); for (${E} e : v) parts.add(${this.fmt(t.of, "e")}); Collections.sort(parts); return "[" + String.join(",", parts) + "]";`;
        break;
      }
      case "map": {
        const K = typeText(t.key);
        body = `if (v == null) return "null"; ArrayList<${K}> keys = new ArrayList<>(v.keySet()); Collections.sort(keys); StringBuilder sb = new StringBuilder("{"); for (int i = 0; i < keys.size(); i++) { if (i > 0) sb.append(','); ${K} k = keys.get(i); sb.append(__wptQ(String.valueOf(k))).append(':').append(${this.fmt(t.value, "v.get(k)")}); } return sb.append('}').toString();`;
        break;
      }
      case "node":
        body = t.name === "ListNode"
          ? `StringBuilder sb = new StringBuilder("["); int guard = 0; for (ListNode p = v; p != null; p = p.next) { if (++guard > 1000000) throw new IllegalStateException("the returned list has a cycle or is too long"); if (guard > 1) sb.append(','); sb.append(p.val); } return sb.append(']').toString();`
          : `if (v == null) return "[]"; ArrayList<String> out = new ArrayList<>(); LinkedList<TreeNode> q = new LinkedList<>(); q.add(v); int guard = 0; while (!q.isEmpty()) { TreeNode c = q.poll(); if (c == null) { out.add("null"); continue; } if (++guard > 1000000) throw new IllegalStateException("the returned tree has a cycle or is too large"); out.add(String.valueOf(c.val)); q.add(c.left); q.add(c.right); } while (!out.isEmpty() && out.get(out.size() - 1).equals("null")) out.remove(out.size() - 1); return "[" + String.join(",", out) + "]";`;
        break;
      default:
        throw new Error("unreachable");
    }
    this.add(name, `    private static String ${name}(${T} v) { ${body} }`);
    return name;
  }

  // ---- one-line arrays: int[] long[] double[] boolean[] (legacy) + short/byte/float/wrappers
  array1Reader(t: Extract<JType, { k: "array" }>): string {
    const e = t.of as Extract<JType, { k: "scalar" }>;
    const legacy: Record<string, [string, string]> = { int: ["ints", "__wptInts"], long: ["longs", "__wptLongs"], double: ["doubles", "__wptDoubles"], boolean: ["bools", "__wptBools"] };
    if (e.name in legacy) {
      this.add(legacy[e.name][0], LEGACY_HELPERS[legacy[e.name][0]]);
      return legacy[e.name][1];
    }
    const name = `__wpt1d_${e.name}`;
    this.add(name, `    private static ${e.name}[] ${name}(String s) {
        s = s.trim();
        if (s.isEmpty()) return new ${e.name}[0];
        String[] p = s.split("\\\\s+");
        ${e.name}[] r = new ${e.name}[p.length];
        for (int i = 0; i < p.length; i++) { String t = p[i]; r[i] = ${fromToken(e.name, "t")}; }
        return r;
    }`);
    return name;
  }
  array1Writer(t: Extract<JType, { k: "array" }>): string {
    const e = t.of as Extract<JType, { k: "scalar" }>;
    const name = `__wptJoin_${e.name}`;
    this.add(name, `    private static String ${name}(${e.name}[] a) {
        if (a == null) return "null";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(' '); sb.append(String.valueOf(a[i])); }
        return sb.toString();
    }`);
    return name;
  }

  itemsReader(t: Extract<JType, { k: "list" | "set" }>): string {
    const e = t.of as Extract<JType, { k: "scalar" }>;
    const name = `__wptItems_${e.name}`;
    this.add(name, `    private static ArrayList<${e.name}> ${name}(BufferedReader in) throws IOException {
        int n = Integer.parseInt(__wptReadLine(in).trim());
        String line = __wptReadLine(in).trim();
        ArrayList<${e.name}> r = new ArrayList<>();
        if (!line.isEmpty()) for (String t : line.split("\\\\s+")) r.add(${fromToken(e.name, "t")});
        if (r.size() != n) throw new IllegalStateException("Test input says " + n + " items but has " + r.size());
        return r;
    }`);
    return name;
  }
  itemsWriter(t: Extract<JType, { k: "list" | "set" }>): string {
    const e = t.of as Extract<JType, { k: "scalar" }>;
    const name = `__wptOutItems_${e.name}`;
    this.add(name, `    private static String ${name}(Collection<${e.name}> c, String sep, boolean sorted) {
        if (c == null) return "null";
        ArrayList<${e.name}> l = new ArrayList<>(c);
        if (sorted) Collections.sort(l);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < l.size(); i++) { if (i > 0) sb.append(sep); sb.append(String.valueOf(l.get(i))); }
        return sb.toString();
    }`);
    return name;
  }

  gridReader(t: Extract<JType, { k: "array" }>): string {
    const e = (t.of as Extract<JType, { k: "array" }>).of as Extract<JType, { k: "scalar" }>;
    const name = `__wptGrid_${e.name}`;
    const row = e.name === "char"
      ? "r[i] = __wptReadLine(in).toCharArray();"
      : `String line = __wptReadLine(in).trim(); String[] p = line.isEmpty() ? new String[0] : line.split("\\\\s+"); r[i] = new ${e.name}[p.length]; for (int j = 0; j < p.length; j++) { String t = p[j]; r[i][j] = ${fromToken(e.name, "t")}; }`;
    this.add(name, `    private static ${e.name}[][] ${name}(BufferedReader in) throws IOException {
        int n = Integer.parseInt(__wptReadLine(in).trim());
        ${e.name}[][] r = new ${e.name}[n][];
        for (int i = 0; i < n; i++) { ${row} }
        return r;
    }`);
    return name;
  }
  gridWriter(t: Extract<JType, { k: "array" }>): string {
    const e = (t.of as Extract<JType, { k: "array" }>).of as Extract<JType, { k: "scalar" }>;
    const name = `__wptOutGrid_${e.name}`;
    const row = e.name === "char"
      ? "sb.append(new String(g[i]));"
      : `for (int j = 0; j < g[i].length; j++) { if (j > 0) sb.append(' '); sb.append(String.valueOf(g[i][j])); }`;
    this.add(name, `    private static String ${name}(${e.name}[][] g) {
        if (g == null) return "null";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < g.length; i++) { if (i > 0) sb.append('\\n'); if (g[i] == null) { sb.append("null"); continue; } ${row} }
        return sb.toString();
    }`);
    return name;
  }
}

/** Java statement declaring parameter `v` and reading it from stdin. */
function readParam(g: Gen, t: JType, v: string): string {
  const T = typeText(t);
  const line = "__wptReadLine(__wptIn)";
  switch (encodingOf(t)) {
    case "line": {
      const n = (t as Extract<JType, { k: "scalar" }>).name;
      if (n === "String") return `String ${v} = ${line};`;
      if (n === "char") { g.add("char", LEGACY_HELPERS.char); return `char ${v} = __wptChar(${line});`; }
      if (n === "Character") { g.add("char", LEGACY_HELPERS.char); return `Character ${v} = __wptChar(${line});`; }
      return `String __wptT_${v} = ${line}.trim(); ${T} ${v} = ${fromToken(n, `__wptT_${v}`)};`;
    }
    case "array1":
      return `${T} ${v} = ${g.array1Reader(t as Extract<JType, { k: "array" }>)}(${line});`;
    case "chars":
      return `char[] ${v} = ${line}.toCharArray();`;
    case "strings":
      g.add("strings", LEGACY_HELPERS.strings);
      return `String[] ${v} = __wptStrings(__wptIn);`;
    case "items": {
      const tt = t as Extract<JType, { k: "list" | "set" }>;
      const call = `${g.itemsReader(tt)}(__wptIn)`;
      const impl = tt.impl;
      const expr = impl === "List" || impl === "ArrayList" ? call : `new ${CONCRETE[impl]}<>(${call})`;
      return `${T} ${v} = ${expr};`;
    }
    case "grid":
      return `${T} ${v} = ${g.gridReader(t as Extract<JType, { k: "array" }>)}(__wptIn);`;
    case "json":
      return `${T} ${v} = ${g.conv(t, `__WptJ.parse(${line})`)};`;
  }
}

/** Java expression (of type String) that writes the value `v` of type `t` the way test outputs are written. */
function writeValue(g: Gen, t: JType, v: string): string {
  switch (encodingOf(t)) {
    case "line":
      return `String.valueOf(${v})`;
    case "array1":
      return `${g.array1Writer(t as Extract<JType, { k: "array" }>)}(${v})`;
    case "chars":
      return `(${v} == null ? "null" : new String(${v}))`;
    case "strings":
      return `(${v} == null ? "null" : String.join("\\n", ${v}))`;
    case "items": {
      const tt = t as Extract<JType, { k: "list" | "set" }>;
      const strings = tt.of.k === "scalar" && tt.of.name === "String";
      return `${g.itemsWriter(tt)}(${v}, ${strings ? '"\\n"' : '" "'}, ${tt.k === "set"})`;
    }
    case "grid":
      return `${g.gridWriter(t as Extract<JType, { k: "array" }>)}(${v})`;
    case "json":
      return g.fmt(t, v);
  }
}

function defaultReturn(t: JType): string | null {
  switch (t.k) {
    case "void": return null;
    case "scalar":
      if (!isPrimitive(t)) return "null";
      return t.name === "double" ? "0.0" : t.name === "float" ? "0.0f" : t.name === "boolean" ? "false" : t.name === "char" ? "'\\0'" : "0";
    case "list": return `new ${CONCRETE[t.impl]}<>()`;
    case "set": return `new ${CONCRETE[t.impl]}<>()`;
    case "map": return `new ${CONCRETE[t.impl]}<>()`;
    default: return "null";
  }
}

/** Build the trusted prefix/suffix and the starter snippets for a function-mode problem. */
export function buildFunctionTemplate(sig: ParsedSignature): FunctionTemplate {
  const prefix =
    IMPORTS.map((i) => `import ${i};`).join("\n") +
    `\n\npublic class Main {\n${EDIT_START}\n`;

  const params = paramTypes(sig);
  const ret = returnJType(sig);
  const g = new Gen();
  g.add("readLine", String.raw`    private static String __wptReadLine(BufferedReader in) throws IOException {
        String s = in.readLine();
        return s == null ? "" : s;
    }`);

  const reads = params.map((p) => `        ${readParam(g, p.j, p.name)}`);
  const args = params.map((p) => p.name).join(", ");
  let call: string;
  let text: string;
  if (ret.k === "void") {
    call = `        ${sig.name}(${args});`;
    text = writeValue(g, params[0].j, params[0].name);
  } else {
    call = `        ${typeText(ret)} __wptResult = ${sig.name}(${args});`;
    text = writeValue(g, ret, "__wptResult");
  }
  if (g.needsJson) g.add("json", JSON_RUNTIME);

  const all = [...params.map((p) => p.j), ret];
  const classes = [
    ...(all.some((t) => usesNode(t, "ListNode")) ? [LISTNODE_CLASS] : []),
    ...(all.some((t) => usesNode(t, "TreeNode")) ? [TREENODE_CLASS] : []),
  ];

  const suffix = `${EDIT_END}

    // ---- platform runner (not editable) ----
${[...g.all(), ...classes].join("\n\n")}

    public static void main(String[] __wptArgs) throws Exception {
        BufferedReader __wptIn = new BufferedReader(new InputStreamReader(System.in));
${reads.join("\n")}
${call}
        String __wptText = ${text};
        System.out.flush();
        System.out.println();
        System.out.println("${RESULT_BEGIN}");
        System.out.println(__wptText);
        System.out.println("${RESULT_END}");
        System.out.flush();
    }
}
`;

  const dr = defaultReturn(ret);
  const body = `    // Write your solution here\n${dr === null ? "" : `    return ${dr};\n`}`;
  const starterMethod = `${sig.declaration} {\n${body}}\n`;
  return { prefix, suffix, starterMethod, starterBody: body };
}

// ---------------------------------------------------------------- pasted boilerplate

const START_RE = /^[ \t]*\/\/[ \t]*[=\-*>#]*[ \t]*(?:WPT:)?(?:STUDENT[ \t]*CODE|EDITABLE(?:[ \t]*REGION)?)[ \t]*[:\-]?[ \t]*(?:START|BEGIN)\b.*$/gim;
const END_RE = /^[ \t]*\/\/[ \t]*[=\-*>#]*[ \t]*(?:WPT:)?(?:STUDENT[ \t]*CODE|EDITABLE(?:[ \t]*REGION)?)[ \t]*[:\-]?[ \t]*END\b.*$/gim;

export class BoilerplateError extends Error {}

export interface ParsedBoilerplate {
  prefix: string;
  starter: string;
  suffix: string;
}

/**
 * Split a pasted full-program boilerplate at explicit editable-region markers, e.g.
 *   // ==== STUDENT CODE START ====
 *   ...starter method...
 *   // ==== STUDENT CODE END ====
 * Exactly one START and one END (in that order) are required. Nothing is guessed.
 */
export function parseBoilerplate(source: string): ParsedBoilerplate {
  const text = source.replace(/\r\n/g, "\n");
  if (!/\bclass\s+Main\b/.test(text)) {
    throw new BoilerplateError("The boilerplate must declare `public class Main` (the runner compiles Main.java).");
  }
  const starts = [...text.matchAll(START_RE)];
  const ends = [...text.matchAll(END_RE)];
  if (starts.length !== 1 || ends.length !== 1) {
    throw new BoilerplateError(
      `Mark the editable region with exactly one "${EDIT_START}" line and one "${EDIT_END}" line (found ${starts.length} start / ${ends.length} end).`,
    );
  }
  const s = starts[0];
  const e = ends[0];
  const sEnd = (s.index ?? 0) + s[0].length;
  const eStart = e.index ?? 0;
  if (eStart < sEnd) throw new BoilerplateError("The END marker must come after the START marker.");

  const prefix = text.slice(0, sEnd).replace(/\n?$/, "\n");
  const starter = text.slice(sEnd, eStart).replace(/^\n/, "").replace(/\n?$/, "\n");
  const suffix = text.slice(eStart).replace(/\n?$/, "\n");
  return { prefix, starter, suffix };
}
