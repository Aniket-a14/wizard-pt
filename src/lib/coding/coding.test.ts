import { describe, expect, it } from "vitest";
import { parseSignature, SignatureError, checkTestInputShape, describeSignatureFormat } from "./signature";
import { buildFunctionTemplate, parseBoilerplate, BoilerplateError, EDIT_START, EDIT_END } from "./harness";
import { composeProgram, validateStudentCode, CodeValidationError, checkBalanced, mapCompileOutput, stripStudentMain } from "./compose";
import { compareOutput, normaliseOutput } from "./compare";
import { summarise } from "./score";
import { extractFunctionResult } from "./evaluate";

describe("parseSignature", () => {
  it("parses the maskCode example", () => {
    const s = parseSignature("public static String maskCode(String code)");
    expect(s.name).toBe("maskCode");
    expect(s.returnType).toBe("String");
    expect(s.params).toEqual([{ type: "String", name: "code" }]);
    expect(s.declaration).toBe("public static String maskCode(String code)");
  });
  it("accepts a trailing brace/semicolon and arrays", () => {
    const s = parseSignature("public static int[] twoSum(int[] nums, int target) {");
    expect(s.params.map((p) => p.type)).toEqual(["int[]", "int"]);
    expect(s.returnType).toBe("int[]");
  });
  it("rejects non-static, unsupported types and garbage", () => {
    expect(() => parseSignature("public int f(int a)")).toThrow(SignatureError);
    expect(() => parseSignature("public static Optional<Integer> f(int a)")).toThrow(SignatureError);
    expect(() => parseSignature("public static Object f(int a)")).toThrow(SignatureError);
    expect(() => parseSignature("public static int f(List<int> xs)")).toThrow(/Use Integer, not int/);
    expect(() => parseSignature("public static int f(Map<Double, Integer> m)")).toThrow(/Map keys/);
    expect(() => parseSignature("public static int f(List<Integer>[] xs)")).toThrow(/Arrays of List/);
    expect(() => parseSignature("public static void f(int a)")).toThrow(SignatureError);
    expect(() => parseSignature("hello world")).toThrow(SignatureError);
    expect(() => parseSignature("public static int f(int a, int a)")).toThrow(SignatureError);
  });
  it("accepts list/set/map/array/node types anywhere, with nesting", () => {
    const s1 = parseSignature("public static int countTwinCodes(ArrayList<String> codes)");
    expect(s1.params).toEqual([{ type: "ArrayList<String>", name: "codes" }]);
    expect(parseSignature("public static int f(List < String >  xs, int k)").params.map((p) => p.type)).toEqual(["List<String>", "int"]);
    expect(parseSignature("public static List<List<Integer>> perms(int[] nums)").returnType).toBe("List<List<Integer>>");
    expect(parseSignature("public static Map<String, List<Integer>> g(String[][] pairs)").returnType).toBe("Map<String, List<Integer>>");
    expect(parseSignature("public static ListNode reverse(ListNode head)").returnType).toBe("ListNode");
    expect(parseSignature("public static TreeNode invert(TreeNode root)").params[0].type).toBe("TreeNode");
    expect(parseSignature("public static int[][] merge(int[][] intervals)").returnType).toBe("int[][]");
    expect(parseSignature("public static boolean f(Set<Integer> a, Integer[] b, char[][] grid)").params.map((p) => p.type)).toEqual(["Set<Integer>", "Integer[]", "char[][]"]);
    expect(parseSignature("public static int f(int... nums)").params[0].type).toBe("int[]");
  });
  it("supports void in-place methods only when the first parameter is mutable", () => {
    expect(parseSignature("public static void rotate(int[] nums, int k)").returnType).toBe("void");
    expect(() => parseSignature("public static void f(int a)")).toThrow(/void method must take/);
    expect(() => parseSignature("public static void f(String s)")).toThrow(/void method must take/);
  });
  it("checks list input shape (count line + one line of items that must match the count)", () => {
    const s = parseSignature("public static int f(ArrayList<String> codes)");
    expect(checkTestInputShape(s, "3\nABC DEF GHI")).toBeNull();
    expect(checkTestInputShape(s, "0\n")).toBeNull();
    expect(checkTestInputShape(s, "3\nABC DEF")).toMatch(/count line says 3 but the next line has 2/);
    expect(checkTestInputShape(s, "x\nABC")).toMatch(/count line/);
  });
  it("checks grid and JSON input shapes, and describes them", () => {
    const g = parseSignature("public static int f(int[][] grid, List<List<Integer>> nested, TreeNode root)");
    expect(checkTestInputShape(g, "2\n1 2\n3 4\n[[1],[2,3]]\n[1,null,2]")).toBeNull();
    expect(checkTestInputShape(g, "3\n1 2\n3 4")).toMatch(/3 rows but only 2 follow/);
    expect(checkTestInputShape(g, "1\n1 2\n[[1],\n[1]")).toMatch(/valid JSON/);
    expect(checkTestInputShape(g, "1\n1 2\n[[1]]\n5")).toMatch(/must be a JSON array/);
    const f = describeSignatureFormat(g);
    expect(f.inputs[0]).toMatch(/row-count line/);
    expect(f.inputs[1]).toMatch(/JSON/);
    expect(f.inputs[2]).toMatch(/level order/);
  });
  it("checks input shape", () => {
    const s = parseSignature("public static int f(int[] a, int k)");
    expect(checkTestInputShape(s, "1 2 3\n2")).toBeNull();
    expect(checkTestInputShape(s, "1 2 3")).toMatch(/Missing/);
    const t = parseSignature("public static String f(String[] a)");
    expect(checkTestInputShape(t, "2\nx\ny")).toBeNull();
    expect(checkTestInputShape(t, "x")).toMatch(/count/);
  });
});

describe("template + compose", () => {
  const sig = parseSignature("public static String maskCode(String code)");
  const tpl = buildFunctionTemplate(sig);
  const cfg = {
    executionMode: "function" as const,
    editableScope: "method" as const,
    functionSignature: sig.declaration,
    templatePrefix: tpl.prefix,
    templateSuffix: tpl.suffix,
  };

  it("generates a wrapper that calls the method and reads stdin", () => {
    expect(tpl.suffix).toContain("maskCode(code)");
    expect(tpl.suffix).toContain("@@WPT_RESULT_BEGIN@@");
    expect(tpl.starterMethod).toContain("public static String maskCode(String code) {");
  });

  it("composes prefix + student + suffix deterministically and never alters the wrapper", () => {
    const student = "public static String maskCode(String code) { return code; }";
    const a = composeProgram(cfg, student);
    const b = composeProgram(cfg, student);
    expect(a.source).toBe(b.source);
    expect(a.source.startsWith(tpl.prefix)).toBe(true);
    expect(a.source.endsWith(tpl.suffix)).toBe(true);
    expect(a.source).toContain(student);
  });

  it("body mode wraps the body in the fixed signature", () => {
    const c = composeProgram({ ...cfg, editableScope: "body" }, "return code;");
    expect(c.source).toContain("public static String maskCode(String code) {\nreturn code;\n}");
    expect(c.lineOffset).toBeGreaterThan(5);
  });

  it("ignores a main() the student pasted along with the method, keeping line numbers", () => {
    const student = [
      "public static String maskCode(String code) {",
      "    return code; // main( is not here",
      "}",
      "",
      "public static void main(String[] args) throws Exception {",
      '    String s = "}{ \\" ; // } tricky',
      "    if (true) { System.out.println(maskCode(s)); }",
      "}",
    ].join("\n");
    const out = stripStudentMain(student);
    expect(out).not.toMatch(/void\s+main/);
    expect(out).toContain("return code;");
    expect(out.split("\n").length).toBe(student.split("\n").length);
    const c = composeProgram(cfg, student);
    expect(c.source.match(/void\s+main\s*\(/g)?.length).toBe(1); // only the platform's own
    expect(c.studentLineCount).toBe(student.split("\n").length);
  });

  it("leaves nested mains, comments and non-main methods alone", () => {
    const keep = [
      "// public static void main(String[] a) {}",
      "static String helper() { return \"static void main(\"; }",
      "static class Inner { public static void main(String[] a) { } }",
      "public static String maskCode(String code) { return code; }",
    ].join("\n");
    expect(stripStudentMain(keep)).toBe(keep);
  });

  it("rejects code that tries to break out of the editable region", () => {
    const base = { executionMode: "function" as const, editableScope: "method" as const, functionSignature: sig.declaration };
    expect(() => validateStudentCode("public static String maskCode(String c){return c;} }", base)).toThrow(CodeValidationError);
    expect(() => validateStudentCode("", base)).toThrow(CodeValidationError);
    expect(() => validateStudentCode(`${EDIT_END}\npublic static String maskCode(String c){return c;}`, base)).toThrow(CodeValidationError);
    expect(() => validateStudentCode("public static int other() { return 1; }", base)).toThrow(/must define the method/);
    expect(() => validateStudentCode("public static String maskCode(String c){ return \"}\"; /* } */ }", base)).not.toThrow();
  });

  it("program mode returns student source untouched and requires Main", () => {
    const base = { executionMode: "program" as const, editableScope: "method" as const, functionSignature: null };
    const src = "public class Main { public static void main(String[] a) {} }";
    expect(composeProgram({ ...cfg, ...base }, src).source).toBe(src);
    expect(() => validateStudentCode("class Foo {}", base)).toThrow(CodeValidationError);
  });

  it("maps compile errors to editor lines", () => {
    const out = "Main.java:12: error: ';' expected\n  int x\nMain.java:2: error: x";
    expect(mapCompileOutput(out, 10, 5)).toContain("Line 2: error");
    expect(mapCompileOutput(out, 10, 5)).toContain("Line (platform wrapper): error");
  });

  it("balance checker ignores strings/comments/char literals", () => {
    expect(checkBalanced('char c = \'{\'; String s = "}"; // {')).toBeNull();
    expect(checkBalanced("void f() {")).toMatch(/Unclosed/);
    expect(checkBalanced("}")).toMatch(/Unmatched/);
  });
});

describe("parseBoilerplate", () => {
  const src = `import java.util.*;
public class Main {
    ${EDIT_START}
    public static int add(int a, int b) {
        return 0;
    }
    ${EDIT_END}
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(add(sc.nextInt(), sc.nextInt()));
    }
}`;
  it("splits at explicit markers", () => {
    const p = parseBoilerplate(src);
    expect(p.prefix).toContain("public class Main {");
    expect(p.starter).toContain("public static int add");
    expect(p.suffix).toContain("Scanner sc");
    expect(p.prefix + p.starter + p.suffix).toContain(EDIT_START);
  });
  it("refuses missing/duplicate markers and missing Main", () => {
    expect(() => parseBoilerplate(src.replace(EDIT_END, ""))).toThrow(BoilerplateError);
    expect(() => parseBoilerplate(src + "\n" + EDIT_START)).toThrow(BoilerplateError);
    expect(() => parseBoilerplate(src.replace("class Main", "class Other"))).toThrow(BoilerplateError);
  });
});

describe("compareOutput", () => {
  it("exact ignores only trailing whitespace/newlines", () => {
    expect(compareOutput("abc\n", "abc", { mode: "exact" }).ok).toBe(true);
    expect(compareOutput("abc  \r\n\n", "abc", { mode: "exact" }).ok).toBe(true);
    expect(compareOutput("ABC", "abc", { mode: "exact" }).ok).toBe(false);
    expect(compareOutput(" abc", "abc", { mode: "exact" }).ok).toBe(false);
    expect(compareOutput("a b", "a  b", { mode: "exact" }).ok).toBe(false);
    expect(compareOutput("a\nb", "b\na", { mode: "exact" }).ok).toBe(false);
  });
  it("trim ignores outer whitespace; tokens ignores all spacing but not case/order", () => {
    expect(compareOutput("  abc \n", "abc", { mode: "trim" }).ok).toBe(true);
    expect(compareOutput("1  2\n3", "1 2 3", { mode: "tokens" }).ok).toBe(true);
    expect(compareOutput("A b", "a b", { mode: "tokens" }).ok).toBe(false);
    expect(compareOutput("2 1", "1 2", { mode: "tokens" }).ok).toBe(false);
  });
  it("float uses tolerance", () => {
    expect(compareOutput("0.3333333", "0.3333334", { mode: "float", floatTolerance: 1e-6 }).ok).toBe(true);
    expect(compareOutput("0.34", "0.33", { mode: "float", floatTolerance: 1e-6 }).ok).toBe(false);
    expect(compareOutput("x 1.0", "x 1", { mode: "float" }).ok).toBe(true);
  });
  it("json mode compares values, ignoring spacing, but list order matters", () => {
    expect(compareOutput("[1,2,3]", "[1, 2, 3]", { mode: "json" }).ok).toBe(true);
    expect(compareOutput("[[1,2],[3]]", "[[1, 2], [3]]", { mode: "json" }).ok).toBe(true);
    expect(compareOutput("[1,3,2]", "[1,2,3]", { mode: "json" }).ok).toBe(false);
    expect(compareOutput('{"a":1,"b":2}', '{"b":2,"a":1}', { mode: "json" }).ok).toBe(true);
    expect(compareOutput("9007199254740993", "9007199254740992", { mode: "json" }).ok).toBe(false); // no precision loss
    expect(compareOutput("0.30000001", "0.3", { mode: "json", floatTolerance: 1e-6 }).ok).toBe(true);
  });
  it("unordered ignores outer list order only; unordered_deep ignores every level", () => {
    expect(compareOutput("[[3],[1,2]]", "[[1,2],[3]]", { mode: "unordered" }).ok).toBe(true);
    expect(compareOutput("[[3],[2,1]]", "[[1,2],[3]]", { mode: "unordered" }).ok).toBe(false);
    expect(compareOutput("[[3],[2,1]]", "[[1,2],[3]]", { mode: "unordered_deep" }).ok).toBe(true);
    expect(compareOutput("[[3],[2,1]]", "[[1,2],[4]]", { mode: "unordered_deep" }).ok).toBe(false);
    // plain (non-JSON) outputs: values per token, or per line
    expect(compareOutput("3 1 2", "1 2 3", { mode: "unordered" }).ok).toBe(true);
    expect(compareOutput("b\na\nc", "a\nb\nc", { mode: "unordered" }).ok).toBe(true);
    expect(compareOutput("a\nb\nb", "a\nb\nc", { mode: "unordered" }).ok).toBe(false);
  });
  it("normaliseOutput", () => expect(normaliseOutput("a \r\nb\n\n")).toBe("a\nb"));
});

describe("summarise", () => {
  const t = (status: string, visibility: "public" | "hidden" = "hidden", weight = 1) => ({ status: status as never, visibility, weight });
  it("accepted / partial / wrong answer / compile error", () => {
    expect(summarise([t("passed", "public"), t("passed")]).verdict).toBe("accepted");
    const p = summarise([t("passed", "public"), t("wrong_answer"), t("passed")]);
    expect(p.verdict).toBe("partial");
    expect(p.scorePct).toBeCloseTo(66.67, 1);
    expect(p.passedPublic).toBe(1);
    expect(p.totalHidden).toBe(2);
    expect(summarise([t("wrong_answer"), t("wrong_answer")]).verdict).toBe("wrong_answer");
    expect(summarise([t("compile_error"), t("compile_error")]).verdict).toBe("compile_error");
    expect(summarise([t("time_limit"), t("wrong_answer")]).verdict).toBe("time_limit");
  });
  it("weights count", () => {
    expect(summarise([t("passed", "public", 3), t("wrong_answer", "hidden", 1)]).scorePct).toBe(75);
  });
  it("a system error never yields accepted", () => {
    const s = summarise([t("passed"), t("system_error")]);
    expect(s.verdict).toBe("system_error");
    expect(summarise([t("system_error")]).scorePct).toBe(0);
  });
});

describe("extractFunctionResult", () => {
  it("separates student prints from the harness result", () => {
    const out = "debug 1\ndebug 2\n\n@@WPT_RESULT_BEGIN@@\nDC-12-BA\n@@WPT_RESULT_END@@\n";
    expect(extractFunctionResult(out)).toEqual({ actual: "DC-12-BA", studentStdout: "debug 1\ndebug 2\n" });
  });
  it("uses the last marker and handles multi-line / empty results", () => {
    const out = "@@WPT_RESULT_BEGIN@@\nfake\n@@WPT_RESULT_END@@\n\n@@WPT_RESULT_BEGIN@@\n\n@@WPT_RESULT_END@@\n";
    expect(extractFunctionResult(out)?.actual).toBe("");
    expect(extractFunctionResult("no markers")).toBeNull();
  });
});

import { prepareCoding } from "./prepare";
import { codingDraftSchema } from "@/lib/validation/question";

describe("prepareCoding", () => {
  const base = {
    questionId: null,
    title: "Reverse Only the Letters",
    config: { function_signature: "public static String maskCode(String code)", starter_code: "" },
    tests: [{ input: "AB-12-CD", expected_output: "DC-12-BA", visibility: "public" as const }],
  };
  it("switches structured (JSON) results to structural comparison, and leaves plain results alone", () => {
    const json = prepareCoding(codingDraftSchema.parse({ ...base, config: { function_signature: "public static List<List<Integer>> f(int[] a)", starter_code: "" }, tests: [{ input: "1 2", expected_output: "[[1],[2]]", visibility: "public" as const }] }));
    expect(json.ok && (json.payload.config as { compare_mode: string }).compare_mode).toBe("json");
    expect(json.ok && json.warnings.join(" ")).toMatch(/structured/);
    const asked = prepareCoding(codingDraftSchema.parse({ ...base, config: { function_signature: "public static List<List<Integer>> f(int[] a)", starter_code: "", compare_mode: "unordered_deep" }, tests: [{ input: "1 2", expected_output: "[[1],[2]]", visibility: "public" as const }] }));
    expect(asked.ok && (asked.payload.config as { compare_mode: string }).compare_mode).toBe("unordered_deep"); // an explicit choice is kept
    const plain = prepareCoding(codingDraftSchema.parse(base));
    expect(plain.ok && (plain.payload.config as { compare_mode: string }).compare_mode).toBe("exact");
    const inPlace = prepareCoding(codingDraftSchema.parse({ ...base, config: { function_signature: "public static void rotate(int[] nums, int k)", starter_code: "" }, tests: [{ input: "1 2 3\n1", expected_output: "3 1 2", visibility: "public" as const }] }));
    expect(inPlace.ok && (inPlace.payload.config as { compare_mode: string }).compare_mode).toBe("exact"); // void + int[] prints plain tokens
  });
  it("supports a custom driver with no signature (class-design problems)", () => {
    const bp = `import java.util.*;\npublic class Main {\n${EDIT_START}\nstatic class Q { }\n${EDIT_END}\n public static void main(String[] a) { System.out.println(1); }\n}`;
    const r = prepareCoding(codingDraftSchema.parse({ ...base, config: { function_signature: "", starter_code: "" }, boilerplate_source: bp }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.payload.config as { function_signature: string; starter_code: string }).function_signature).toBe("");
    expect((r.payload.config as { starter_code: string }).starter_code).toContain("static class Q");
    expect((r.payload.secrets as { template_suffix: string }).template_suffix).toContain("public static void main");
    // without a boilerplate an empty signature is still an error
    expect(prepareCoding(codingDraftSchema.parse({ ...base, config: { function_signature: "", starter_code: "" } })).ok).toBe(false);
  });
  it("generates wrapper + starter from the signature", () => {
    const r = prepareCoding(codingDraftSchema.parse(base));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const secrets = r.payload.secrets as { template_prefix: string; template_suffix: string };
    expect(secrets.template_prefix).toContain("public class Main");
    expect(secrets.template_suffix).toContain("maskCode(code)");
    expect((r.payload.config as { starter_code: string }).starter_code).toContain("Write your solution here");
  });
  it("uses a pasted boilerplate split by markers", () => {
    const bp = `public class Main {\n${EDIT_START}\npublic static String maskCode(String code) { return code; }\n${EDIT_END}\npublic static void main(String[] a) { System.out.println(maskCode("x")); }\n}`;
    const r = prepareCoding(codingDraftSchema.parse({ ...base, boilerplate_source: bp }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.payload.secrets as { template_suffix: string }).template_suffix).toContain("main(String[] a)");
  });
  it("reports bad signatures / boilerplate as field errors", () => {
    const r = prepareCoding(codingDraftSchema.parse({ ...base, config: { function_signature: "nonsense", starter_code: "" } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors["config.function_signature"]).toBeDefined();
    const r2 = prepareCoding(codingDraftSchema.parse({ ...base, boilerplate_source: "public class Main {}" }));
    expect(r2.ok).toBe(false);
  });
  it("warns about test inputs that don't match the signature", () => {
    const r = prepareCoding(codingDraftSchema.parse({ ...base, config: { function_signature: "public static int f(int a, int b)", starter_code: "" }, tests: [{ input: "1", expected_output: "2", visibility: "public" }] }));
    expect(r.ok && r.warnings.some((w) => /Missing/.test(w))).toBe(true);
  });
});
