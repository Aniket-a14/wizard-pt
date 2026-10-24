import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DockerRunner } from "@/lib/runner/docker";
import { evaluate, type EvalConfig, type EvalTest } from "@/lib/coding/evaluate";
import { buildFunctionTemplate } from "@/lib/coding/harness";
import { parseSignature } from "@/lib/coding/signature";
import type { Runner } from "@/lib/runner/types";

const IMAGE = process.env.RUNNER_DOCKER_IMAGE ?? "eclipse-temurin:21-jdk";
function dockerReady(): boolean {
  try {
    execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const ready = dockerReady();
const runner: Runner = new DockerRunner({ image: IMAGE, parallelism: 4 });

function cfgFor(signature: string, scope: "method" | "body" = "method", extra: Partial<EvalConfig> = {}): EvalConfig {
  const sig = parseSignature(signature);
  const tpl = buildFunctionTemplate(sig);
  return {
    executionMode: "function",
    editableScope: scope,
    functionSignature: sig.declaration,
    templatePrefix: tpl.prefix,
    templateSuffix: tpl.suffix,
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    compareMode: "exact",
    floatTolerance: 1e-6,
    revealHidden: false,
    ...extra,
  };
}

const mk = (id: string, input: string, expectedOutput: string, visibility: "public" | "hidden" = "public"): EvalTest =>
  ({ id, input, expectedOutput, visibility, weight: 1 });

const MASK_SIG = "public static String maskCode(String code)";
const MASK_TESTS: EvalTest[] = [
  mk("p1", "AB-12-CD", "DC-12-BA"),
  mk("p2", "Ja#va-21", "av#aJ-21"),
  mk("p3", "1234", "1234"),
  mk("p4", "x-Y", "Y-x"),
  mk("h1", "a", "a", "hidden"),
  mk("h2", "a-b-c", "c-b-a", "hidden"),
  mk("h3", "!!!###", "!!!###", "hidden"),
  mk("h4", "A".repeat(50000) + "-" + "b".repeat(49999), "b".repeat(49999) + "A" + "-" + "A".repeat(49999), "hidden"),
];

const REFERENCE = `public static String maskCode(String code) {
    char[] chars = code.toCharArray();
    int left = 0;
    int right = chars.length - 1;
    while (left < right) {
        if (!Character.isLetter(chars[left])) {
            left++;
        } else if (!Character.isLetter(chars[right])) {
            right--;
        } else {
            char temp = chars[left];
            chars[left] = chars[right];
            chars[right] = temp;
            left++;
            right--;
        }
    }
    return new String(chars);
}`;

describe.skipIf(!ready)("Java execution through the Docker sandbox", () => {
  it("accepts the reference solution on public + hidden tests (real compile + run)", async () => {
    const r = await evaluate({ config: cfgFor(MASK_SIG), tests: MASK_TESTS, studentCode: REFERENCE, runner });
    expect(r.systemError).toBeNull();
    expect(r.summary.verdict).toBe("accepted");
    expect(r.summary.passedPublic).toBe(4);
    expect(r.summary.passedHidden).toBe(4);
    expect(r.summary.scorePct).toBe(100);
    expect(r.execTimeMs).toBeGreaterThan(0);
  });

  it("body-only mode works", async () => {
    const body = REFERENCE.replace(/^public static String maskCode\(String code\) \{\n/, "").replace(/\}$/, "");
    const r = await evaluate({ config: cfgFor(MASK_SIG, "body"), tests: MASK_TESTS, studentCode: body, runner });
    expect(r.summary.verdict).toBe("accepted");
  });

  it("marks a naive (wrong) solution as wrong answer / partial", async () => {
    const wrong = `public static String maskCode(String code) { return new StringBuilder(code).reverse().toString(); }`;
    const r = await evaluate({ config: cfgFor(MASK_SIG), tests: MASK_TESTS, studentCode: wrong, runner });
    expect(["wrong_answer", "partial"]).toContain(r.summary.verdict);
    expect(r.summary.scorePct).toBeLessThan(100);
    const p1 = r.full.find((x) => x.testId === "p1")!;
    expect(p1.status).toBe("wrong_answer");
    expect(p1.actual).toBe("DC-21-BA");
  });

  it("hides hidden-test details from the student view", async () => {
    const wrong = `public static String maskCode(String code) { return code; }`;
    const r = await evaluate({ config: cfgFor(MASK_SIG), tests: MASK_TESTS, studentCode: wrong, runner });
    const hidden = r.student.filter((x) => x.visibility === "hidden");
    expect(hidden.length).toBe(4);
    for (const h of hidden) {
      expect(h).not.toHaveProperty("input");
      expect(h).not.toHaveProperty("expected");
      expect(h).not.toHaveProperty("actual");
    }
    const pub = r.student.find((x) => x.visibility === "public")!;
    expect(pub.expected).toBeDefined();
  });

  it("reports compile errors with editor line numbers", async () => {
    const bad = `public static String maskCode(String code) {\n    int x = ;\n    return code;\n}`;
    const r = await evaluate({ config: cfgFor(MASK_SIG), tests: MASK_TESTS, studentCode: bad, runner });
    expect(r.summary.verdict).toBe("compile_error");
    expect(r.compileOutput).toMatch(/Line 2/);
    expect(r.summary.scorePct).toBe(0);
  });

  it("reports runtime exceptions", async () => {
    const bad = `public static String maskCode(String code) { return code.substring(100000); }`;
    const r = await evaluate({ config: cfgFor(MASK_SIG), tests: MASK_TESTS.slice(0, 2), studentCode: bad, runner });
    expect(r.summary.verdict).toBe("runtime_error");
    expect(r.student[0].stderr).toMatch(/StringIndexOutOfBounds/);
  });

  it("kills infinite loops (time limit)", async () => {
    const loop = `public static String maskCode(String code) { while (true) {} }`;
    const r = await evaluate({
      config: cfgFor(MASK_SIG, "method", { timeLimitMs: 1000 }),
      tests: MASK_TESTS.slice(0, 1),
      studentCode: loop,
      runner,
    });
    expect(r.summary.verdict).toBe("time_limit");
  });

  it("enforces the memory limit", async () => {
    const hog = `public static String maskCode(String code) { long[][] a = new long[64][]; for (int i = 0; i < 64; i++) a[i] = new long[8_000_000]; return code; }`;
    const r = await evaluate({
      config: cfgFor(MASK_SIG, "method", { memoryLimitMb: 128 }),
      tests: MASK_TESTS.slice(0, 1),
      studentCode: hog,
      runner,
    });
    expect(r.summary.verdict).toBe("memory_limit");
  });

  it("student debug prints do not corrupt the result", async () => {
    const noisy = `public static String maskCode(String code) { System.out.println("debugging " + code); System.out.println("@@WPT_RESULT_END@@"); return ${"\"x\""}; }`;
    const r = await evaluate({ config: cfgFor(MASK_SIG), tests: [mk("t", "ab", "x")], studentCode: noisy, runner });
    expect(r.summary.verdict).toBe("accepted");
    expect(r.student[0].studentStdout).toContain("debugging ab");
  });

  it("System.exit before returning is not a pass", async () => {
    const exit = `public static String maskCode(String code) { System.exit(0); return code; }`;
    const r = await evaluate({ config: cfgFor(MASK_SIG), tests: [mk("t", "ab", "ab")], studentCode: exit, runner });
    expect(r.summary.verdict).toBe("runtime_error");
  });

  it("supports int arrays, multiple parameters and String[] / array returns", async () => {
    const sum = await evaluate({
      config: cfgFor("public static int[] addToAll(int[] nums, int k)"),
      tests: [mk("a", "1 2 3\n10", "11 12 13"), mk("b", "\n5", "", "hidden")],
      studentCode: `public static int[] addToAll(int[] nums, int k) { int[] r = new int[nums.length]; for (int i = 0; i < nums.length; i++) r[i] = nums[i] + k; return r; }`,
      runner,
    });
    expect(sum.summary.verdict).toBe("accepted");

    const strs = await evaluate({
      config: cfgFor("public static String[] upper(String[] words)"),
      tests: [mk("a", "2\nhello world\nfoo", "HELLO WORLD\nFOO")],
      studentCode: `public static String[] upper(String[] w) { return Arrays.stream(w).map(String::toUpperCase).toArray(String[]::new); }`,
      runner,
    });
    expect(strs.summary.verdict).toBe("accepted");

    const dbl = await evaluate({
      config: cfgFor("public static double avg(int a, int b)", "method", { compareMode: "float" }),
      tests: [mk("a", "1\n2", "1.5")],
      studentCode: `public static double avg(int a, int b) { return (a + b) / 2.0; }`,
      runner,
    });
    expect(dbl.summary.verdict).toBe("accepted");

    const bool = await evaluate({
      config: cfgFor("public static boolean isPal(String s)"),
      tests: [mk("a", "abba", "true"), mk("b", "abc", "false")],
      studentCode: `public static boolean isPal(String s) { return new StringBuilder(s).reverse().toString().equals(s); }`,
      runner,
    });
    expect(bool.summary.verdict).toBe("accepted");
  });

  it("full-program mode uses stdin/stdout", async () => {
    const prog = `import java.util.*;
public class Main { public static void main(String[] a) { Scanner sc = new Scanner(System.in); int x = sc.nextInt(), y = sc.nextInt(); System.out.println(x + y); } }`;
    const r = await evaluate({
      config: {
        executionMode: "program", editableScope: "method", functionSignature: null, templatePrefix: "", templateSuffix: "",
        timeLimitMs: 2000, memoryLimitMb: 256, compareMode: "exact", floatTolerance: 1e-6, revealHidden: false,
      },
      tests: [mk("a", "2 3", "5"), mk("b", "10 -4", "6", "hidden")],
      studentCode: prog,
      runner,
    });
    expect(r.summary.verdict).toBe("accepted");
  });

  it("a failed runner request is never Accepted", async () => {
    const broken: Runner = {
      name: "broken",
      health: async () => ({ ok: false, detail: "down" }),
      execute: async () => {
        throw new Error("connection refused");
      },
    };
    const r = await evaluate({ config: cfgFor(MASK_SIG), tests: MASK_TESTS, studentCode: REFERENCE, runner: broken });
    expect(r.summary.verdict).toBe("system_error");
    expect(r.systemError).toMatch(/connection refused/);
    expect(r.full.every((x) => x.status === "system_error")).toBe(true);
  });
});
