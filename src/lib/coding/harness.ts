import type { JavaType, ParsedSignature } from "./signature";

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

function defaultReturn(t: JavaType): string {
  switch (t) {
    case "int":
    case "long":
      return "0";
    case "double":
      return "0.0";
    case "boolean":
      return "false";
    case "char":
      return "'\\0'";
    default:
      return "null";
  }
}

function readExpr(t: JavaType, varName: string): string {
  const line = "__wptReadLine(__wptIn)";
  switch (t) {
    case "String":
      return `String ${varName} = ${line};`;
    case "int":
      return `int ${varName} = Integer.parseInt(${line}.trim());`;
    case "long":
      return `long ${varName} = Long.parseLong(${line}.trim());`;
    case "double":
      return `double ${varName} = Double.parseDouble(${line}.trim());`;
    case "boolean":
      return `boolean ${varName} = Boolean.parseBoolean(${line}.trim());`;
    case "char":
      return `char ${varName} = __wptChar(${line});`;
    case "int[]":
      return `int[] ${varName} = __wptInts(${line});`;
    case "long[]":
      return `long[] ${varName} = __wptLongs(${line});`;
    case "double[]":
      return `double[] ${varName} = __wptDoubles(${line});`;
    case "boolean[]":
      return `boolean[] ${varName} = __wptBools(${line});`;
    case "String[]":
      return `String[] ${varName} = __wptStrings(__wptIn);`;
  }
}

const HELPERS: Record<string, string> = {
  char: `    private static char __wptChar(String s) { return s.isEmpty() ? (char) 0 : s.charAt(0); }`,
  ints: `    private static int[] __wptInts(String s) {
        s = s.trim();
        if (s.isEmpty()) return new int[0];
        String[] p = s.split("\\\\s+");
        int[] r = new int[p.length];
        for (int i = 0; i < p.length; i++) r[i] = Integer.parseInt(p[i]);
        return r;
    }`,
  longs: `    private static long[] __wptLongs(String s) {
        s = s.trim();
        if (s.isEmpty()) return new long[0];
        String[] p = s.split("\\\\s+");
        long[] r = new long[p.length];
        for (int i = 0; i < p.length; i++) r[i] = Long.parseLong(p[i]);
        return r;
    }`,
  doubles: `    private static double[] __wptDoubles(String s) {
        s = s.trim();
        if (s.isEmpty()) return new double[0];
        String[] p = s.split("\\\\s+");
        double[] r = new double[p.length];
        for (int i = 0; i < p.length; i++) r[i] = Double.parseDouble(p[i]);
        return r;
    }`,
  bools: `    private static boolean[] __wptBools(String s) {
        s = s.trim();
        if (s.isEmpty()) return new boolean[0];
        String[] p = s.split("\\\\s+");
        boolean[] r = new boolean[p.length];
        for (int i = 0; i < p.length; i++) r[i] = Boolean.parseBoolean(p[i]);
        return r;
    }`,
  strings: `    private static String[] __wptStrings(BufferedReader in) throws IOException {
        int n = Integer.parseInt(__wptReadLine(in).trim());
        String[] r = new String[n];
        for (int i = 0; i < n; i++) r[i] = __wptReadLine(in);
        return r;
    }`,
};

function helpersFor(types: JavaType[]): string[] {
  const need = new Set<string>();
  for (const t of types) {
    if (t === "char") need.add("char");
    if (t === "int[]") need.add("ints");
    if (t === "long[]") need.add("longs");
    if (t === "double[]") need.add("doubles");
    if (t === "boolean[]") need.add("bools");
    if (t === "String[]") need.add("strings");
  }
  return [...need].map((k) => HELPERS[k]);
}

function formatExpr(t: JavaType): string {
  switch (t) {
    case "String[]":
      return "String.join(\"\\n\", __wptResult)";
    case "int[]":
    case "long[]":
    case "double[]":
    case "boolean[]":
      return "__wptJoin(__wptResult)";
    default:
      return "String.valueOf(__wptResult)";
  }
}

function joinHelper(t: JavaType): string | null {
  const boxed: Record<string, string> = { "int[]": "int", "long[]": "long", "double[]": "double", "boolean[]": "boolean" };
  const prim = boxed[t];
  if (!prim) return null;
  return `    private static String __wptJoin(${prim}[] a) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(' '); sb.append(a[i]); }
        return sb.toString();
    }`;
}

/** Build the trusted prefix/suffix and the starter snippets for a function-mode problem. */
export function buildFunctionTemplate(sig: ParsedSignature): FunctionTemplate {
  const prefix =
    IMPORTS.map((i) => `import ${i};`).join("\n") +
    `\n\npublic class Main {\n${EDIT_START}\n`;

  const reads = sig.params.map((p) => `        ${readExpr(p.type, p.name)}`);
  const args = sig.params.map((p) => p.name).join(", ");
  const retJoin = joinHelper(sig.returnType);
  const helpers = [
    `    private static String __wptReadLine(BufferedReader in) throws IOException {
        String s = in.readLine();
        return s == null ? "" : s;
    }`,
    ...helpersFor([...sig.params.map((p) => p.type)]),
    ...(retJoin ? [retJoin] : []),
  ];

  const suffix = `${EDIT_END}

    // ---- platform runner (not editable) ----
${helpers.join("\n\n")}

    public static void main(String[] __wptArgs) throws Exception {
        BufferedReader __wptIn = new BufferedReader(new InputStreamReader(System.in));
${reads.join("\n")}
        ${sig.returnType} __wptResult = ${sig.name}(${args});
        String __wptText = ${formatExpr(sig.returnType)};
        System.out.flush();
        System.out.println();
        System.out.println("${RESULT_BEGIN}");
        System.out.println(__wptText);
        System.out.println("${RESULT_END}");
        System.out.flush();
    }
}
`;

  const ret = defaultReturn(sig.returnType);
  const starterMethod = `${sig.declaration} {\n    // Write your solution here\n    return ${ret};\n}\n`;
  const starterBody = `    // Write your solution here\n    return ${ret};\n`;
  return { prefix, suffix, starterMethod, starterBody };
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
