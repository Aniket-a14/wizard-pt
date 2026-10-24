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

  it("supports ArrayList<String> parameters (count line, then one line of items)", async () => {
    const sig = "public static int countTwinCodes(ArrayList<String> codes)";
    const reference = `public static int countTwinCodes(ArrayList<String> codes) {
      int n = codes.size(); String[] k = new String[n];
      for (int i = 0; i < n; i++) { char[] c = codes.get(i).toCharArray(); Arrays.sort(c); k[i] = new String(c); }
      Arrays.sort(k); int count = 0, i = 0;
      while (i < n) { int j = i; while (j < n && k[j].equals(k[i])) j++; if (j - i >= 2) count += j - i; i = j; }
      return count; }`;
    const tests = [
      mk("a", "7\nLISTEN SILENT ENLIST GOOGLE CODE DECO JAVA", "5"),
      mk("b", "3\nABC DEF GHI", "0"),
      mk("c", "4\nAAB ABA BAA AB", "3", "hidden"),
      mk("d", "0\n", "0", "hidden"),
    ];
    const ok = await evaluate({ config: cfgFor(sig), tests, studentCode: reference, runner });
    expect(ok.compileOutput).toBeNull();
    expect(ok.summary.verdict).toBe("accepted");
    // a List<String> parameter works the same way
    const asList = await evaluate({
      config: cfgFor("public static int size(List<String> xs)"),
      tests: [mk("a", "2\nX Y", "2")],
      studentCode: "public static int size(List<String> xs) { return xs.size(); }",
      runner,
    });
    expect(asList.summary.verdict).toBe("accepted");
    // a wrong solution (counts every code) is not accepted
    const wrong = await evaluate({ config: cfgFor(sig), tests, studentCode: "public static int countTwinCodes(ArrayList<String> codes) { return codes.size(); }", runner });
    expect(wrong.summary.verdict).not.toBe("accepted");
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

// ---------------------------------------------------------------------------------------------------------
// Breadth: the kinds of problems a DSA course actually uses. Every case compiles and runs real Java.

async function accepted(sig: string, tests: EvalTest[], code: string, extra: Partial<EvalConfig> = {}) {
  const out = await evaluate({ config: cfgFor(sig, "method", extra), tests, studentCode: code, runner });
  const detail = out.compileOutput ?? out.full.filter((t) => t.status !== "passed").map((t) => `${t.testId}: ${t.status} actual=${JSON.stringify(t.actual)} expected=${JSON.stringify(t.expected)} ${t.stderr} ${t.message ?? ""}`).join("\n");
  expect({ verdict: out.summary.verdict, detail }).toEqual({ verdict: "accepted", detail: "" });
  return out;
}

describe.skipIf(!ready)("DSA type coverage (real compile + run)", () => {
  it("List / ArrayList of Integer in and out, empty included", async () => {
    await accepted("public static int sum(List<Integer> xs)", [mk("a", "3\n1 2 3", "6"), mk("b", "0\n", "0"), mk("c", "2\n-5 5", "0")],
      "public static int sum(List<Integer> xs) { int s = 0; for (int x : xs) s += x; return s; }");
    await accepted("public static ArrayList<Integer> doubled(ArrayList<Integer> xs)", [mk("a", "3\n1 2 3", "2 4 6"), mk("b", "0\n", "")],
      "public static ArrayList<Integer> doubled(ArrayList<Integer> xs) { ArrayList<Integer> r = new ArrayList<>(); for (int x : xs) r.add(2 * x); return r; }");
  });

  it("List<String> out is one item per line; Set<Integer> out is printed sorted", async () => {
    await accepted("public static List<String> upper(List<String> xs)", [mk("a", "2\nab cd", "AB\nCD")],
      "public static List<String> upper(List<String> xs) { List<String> r = new ArrayList<>(); for (String s : xs) r.add(s.toUpperCase()); return r; }");
    await accepted("public static Set<Integer> dedupe(List<Integer> xs)", [mk("a", "6\n3 1 2 3 1 9", "1 2 3 9")],
      "public static Set<Integer> dedupe(List<Integer> xs) { return new HashSet<>(xs); }");
    await accepted("public static int uniqueCount(TreeSet<Long> s)", [mk("a", "3\n5 5 7", "2")], "public static int uniqueCount(TreeSet<Long> s) { return s.size(); }");
  });

  it("Map in (JSON) and Map out (sorted JSON, compared structurally)", async () => {
    await accepted("public static int total(Map<String, Integer> m)", [mk("a", '{"a":1,"b":2,"c":39}', "42"), mk("b", "{}", "0")],
      "public static int total(Map<String, Integer> m) { int t = 0; for (int v : m.values()) t += v; return t; }");
    await accepted("public static Map<String, Integer> wordCount(String[] words)", [mk("a", "3\nb\na\nb", '{"a": 1, "b": 2}')],
      "public static Map<String, Integer> wordCount(String[] words) { Map<String, Integer> m = new HashMap<>(); for (String w : words) m.merge(w, 1, Integer::sum); return m; }",
      { compareMode: "json" });
    await accepted("public static Map<Integer, List<String>> byLength(List<String> words)", [mk("a", "4\nhi yo cat dog", '{"2":["hi","yo"],"3":["cat","dog"]}')],
      "public static Map<Integer, List<String>> byLength(List<String> words) { Map<Integer, List<String>> m = new TreeMap<>(); for (String w : words) m.computeIfAbsent(w.length(), k -> new ArrayList<>()).add(w); return m; }",
      { compareMode: "json" });
  });

  it("2-D arrays: int[][] in/out, char[][] grids, jagged rows", async () => {
    await accepted("public static int[][] transpose(int[][] m)", [mk("a", "2\n1 2 3\n4 5 6", "1 4\n2 5\n3 6")],
      "public static int[][] transpose(int[][] m) { int r = m.length, c = m[0].length; int[][] t = new int[c][r]; for (int i = 0; i < r; i++) for (int j = 0; j < c; j++) t[j][i] = m[i][j]; return t; }");
    await accepted("public static int numIslands(char[][] grid)", [mk("a", "3\n11000\n11000\n00100", "2"), mk("b", "1\n0", "0"), mk("c", "2\n101\n010", "3")],
      `public static int numIslands(char[][] g) { int n = 0; for (int i = 0; i < g.length; i++) for (int j = 0; j < g[i].length; j++) if (g[i][j] == '1') { n++; dfs(g, i, j); } return n; }
       static void dfs(char[][] g, int i, int j) { if (i < 0 || j < 0 || i >= g.length || j >= g[i].length || g[i][j] != '1') return; g[i][j] = '0'; dfs(g, i + 1, j); dfs(g, i - 1, j); dfs(g, i, j + 1); dfs(g, i, j - 1); }`);
    await accepted("public static int[][] merge(int[][] intervals)", [mk("a", "4\n1 3\n2 6\n8 10\n15 18", "1 6\n8 10\n15 18"), mk("b", "2\n1 4\n4 5", "1 5")],
      "public static int[][] merge(int[][] a) { Arrays.sort(a, (x, y) -> x[0] - y[0]); List<int[]> r = new ArrayList<>(); for (int[] c : a) { if (r.isEmpty() || r.get(r.size() - 1)[1] < c[0]) r.add(c); else r.get(r.size() - 1)[1] = Math.max(r.get(r.size() - 1)[1], c[1]); } return r.toArray(new int[0][]); }");
    await accepted("public static int sumRows(int[][] rows)", [mk("a", "3\n1 2\n\n3", "6")], // an empty (jagged) row
      "public static int sumRows(int[][] rows) { int s = 0; for (int[] r : rows) for (int x : r) s += x; return s; }");
  });

  it("nested lists as JSON; 'any order' answers via the unordered modes", async () => {
    const subsets = `public static List<List<Integer>> subsets(int[] nums) { List<List<Integer>> r = new ArrayList<>(); for (int m = 0; m < (1 << nums.length); m++) { List<Integer> s = new ArrayList<>(); for (int i = 0; i < nums.length; i++) if ((m >> i & 1) == 1) s.add(nums[i]); r.add(s); } return r; }`;
    await accepted("public static List<List<Integer>> subsets(int[] nums)", [mk("a", "1 2", "[[],[2],[1,2],[1]]")], subsets, { compareMode: "unordered" });
    const wrongOrderInside = await evaluate({ config: cfgFor("public static List<List<Integer>> subsets(int[] nums)", "method", { compareMode: "unordered" }), tests: [mk("a", "1 2", "[[],[2],[2,1],[1]]")], studentCode: subsets, runner });
    expect(wrongOrderInside.summary.verdict).not.toBe("accepted"); // inner order matters in "unordered"
    await accepted("public static List<List<Integer>> subsets(int[] nums)", [mk("a", "1 2", "[[],[2],[2,1],[1]]")], subsets, { compareMode: "unordered_deep" });
    await accepted("public static List<List<String>> group(String[] w)", [mk("a", "4\neat\ntea\nbat\ntab", '[["bat","tab"],["eat","tea"]]')],
      "public static List<List<String>> group(String[] w) { Map<String, List<String>> m = new TreeMap<>(); for (String s : w) { char[] c = s.toCharArray(); Arrays.sort(c); m.computeIfAbsent(new String(c), k -> new ArrayList<>()).add(s); } return new ArrayList<>(m.values()); }",
      { compareMode: "unordered_deep" });
    await accepted("public static int total(List<List<Integer>> rows)", [mk("a", "[[1,2],[3],[]]", "6")],
      "public static int total(List<List<Integer>> rows) { int t = 0; for (List<Integer> r : rows) for (int x : r) t += x; return t; }");
  });

  it("linked lists (ListNode) in and out", async () => {
    const rev = "public static ListNode reverseList(ListNode head) { ListNode prev = null; while (head != null) { ListNode nx = head.next; head.next = prev; prev = head; head = nx; } return prev; }";
    await accepted("public static ListNode reverseList(ListNode head)", [mk("a", "[1,2,3,4]", "[4,3,2,1]"), mk("b", "[]", "[]"), mk("c", "[7]", "[7]")], rev);
    await accepted("public static int length(ListNode head)", [mk("a", "[5,6,7]", "3"), mk("b", "[]", "0")],
      "public static int length(ListNode head) { int n = 0; while (head != null) { n++; head = head.next; } return n; }");
    await accepted("public static ListNode mergeTwo(ListNode a, ListNode b)", [mk("a", "[1,2,4]\n[1,3,4]", "[1,1,2,3,4,4]"), mk("b", "[]\n[]", "[]")],
      "public static ListNode mergeTwo(ListNode a, ListNode b) { ListNode d = new ListNode(0), t = d; while (a != null && b != null) { if (a.val <= b.val) { t.next = a; a = a.next; } else { t.next = b; b = b.next; } t = t.next; } t.next = a != null ? a : b; return d.next; }");
  });

  it("binary trees (TreeNode) in level-order JSON with nulls, in and out", async () => {
    await accepted("public static int maxDepth(TreeNode root)", [mk("a", "[3,9,20,null,null,15,7]", "3"), mk("b", "[]", "0"), mk("c", "[1,null,2]", "2")],
      "public static int maxDepth(TreeNode r) { return r == null ? 0 : 1 + Math.max(maxDepth(r.left), maxDepth(r.right)); }");
    await accepted("public static TreeNode invert(TreeNode root)", [mk("a", "[4,2,7,1,3,6,9]", "[4,7,2,9,6,3,1]"), mk("b", "[1,2]", "[1,null,2]"), mk("c", "[]", "[]")],
      "public static TreeNode invert(TreeNode r) { if (r == null) return null; TreeNode l = r.left; r.left = invert(r.right); r.right = invert(l); return r; }");
    await accepted("public static List<List<Integer>> levelOrder(TreeNode root)", [mk("a", "[3,9,20,null,null,15,7]", "[[3],[9,20],[15,7]]"), mk("b", "[]", "[]")],
      "public static List<List<Integer>> levelOrder(TreeNode root) { List<List<Integer>> res = new ArrayList<>(); if (root == null) return res; Queue<TreeNode> q = new LinkedList<>(); q.add(root); while (!q.isEmpty()) { int n = q.size(); List<Integer> lvl = new ArrayList<>(); for (int i = 0; i < n; i++) { TreeNode c = q.poll(); lvl.add(c.val); if (c.left != null) q.add(c.left); if (c.right != null) q.add(c.right); } res.add(lvl); } return res; }");
  });

  it("void methods that edit their first argument in place", async () => {
    await accepted("public static void rotate(int[] nums, int k)", [mk("a", "1 2 3 4 5\n2", "4 5 1 2 3")],
      "public static void rotate(int[] nums, int k) { int n = nums.length; int[] c = nums.clone(); for (int i = 0; i < n; i++) nums[(i + k) % n] = c[i]; }");
    await accepted("public static void reverseString(char[] s)", [mk("a", "hello", "olleh"), mk("b", "a", "a")],
      "public static void reverseString(char[] s) { for (int i = 0, j = s.length - 1; i < j; i++, j--) { char t = s[i]; s[i] = s[j]; s[j] = t; } }");
    await accepted("public static void sortInPlace(List<Integer> xs)", [mk("a", "3\n3 1 2", "1 2 3")], "public static void sortInPlace(List<Integer> xs) { Collections.sort(xs); }");
    await accepted("public static void setZeroes(int[][] m)", [mk("a", "3\n1 1 1\n1 0 1\n1 1 1", "1 0 1\n0 0 0\n1 0 1")],
      "public static void setZeroes(int[][] m) { int r = m.length, c = m[0].length; boolean[] zr = new boolean[r], zc = new boolean[c]; for (int i = 0; i < r; i++) for (int j = 0; j < c; j++) if (m[i][j] == 0) { zr[i] = true; zc[j] = true; } for (int i = 0; i < r; i++) for (int j = 0; j < c; j++) if (zr[i] || zc[j]) m[i][j] = 0; }");
  });

  it("wrappers, null, and the other numeric types", async () => {
    await accepted("public static Integer pick(Integer x)", [mk("a", "5", "5"), mk("b", "null", "null")], "public static Integer pick(Integer x) { return x; }");
    await accepted("public static long mix(long a, short b, byte c)", [mk("a", "10000000000\n3\n4", "10000000007")], "public static long mix(long a, short b, byte c) { return a + b + c; }");
    await accepted("public static float half(float f)", [mk("a", "3.0", "1.5")], "public static float half(float f) { return f / 2; }");
    await accepted("public static String[][] pairs(String[][] p)", [mk("a", "2\na b\nc d", "a b\nc d")], "public static String[][] pairs(String[][] p) { return p; }");
    await accepted("public static Boolean both(boolean a, Boolean b)", [mk("a", "true\nfalse", "false"), mk("b", "true\ntrue", "true")], "public static Boolean both(boolean a, Boolean b) { return a && b; }");
    await accepted("public static char first(char[] cs)", [mk("a", "xyz", "x")], "public static char first(char[] cs) { return cs[0]; }");
  });

  it("a returned null prints null; a student exception is a runtime error, never a pass", async () => {
    const nul = await evaluate({ config: cfgFor("public static List<Integer> f(int n)"), tests: [mk("a", "3", "null")], studentCode: "public static List<Integer> f(int n) { return null; }", runner });
    expect(nul.summary.verdict).toBe("accepted");
    const npe = await evaluate({ config: cfgFor("public static int g(TreeNode root)"), tests: [mk("a", "[]", "0")], studentCode: "public static int g(TreeNode r) { return r.val; }", runner });
    expect(npe.summary.verdict).not.toBe("accepted");
    expect(npe.full[0].status).toBe("runtime_error");
  });

  it("class-design problems with the admin's own driver (Min Stack)", async () => {
    const boiler = `import java.util.*;

public class Main {
${"// ==== STUDENT CODE START ===="}
static class MinStack { }
${"// ==== STUDENT CODE END ===="}
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int q = sc.nextInt();
        MinStack st = new MinStack();
        StringBuilder out = new StringBuilder();
        while (q-- > 0) {
            String op = sc.next();
            if (op.equals("push")) st.push(sc.nextInt());
            else if (op.equals("pop")) st.pop();
            else if (op.equals("top")) out.append(st.top()).append("\\n");
            else out.append(st.getMin()).append("\\n");
        }
        System.out.print(out);
    }
}
`;
    const { parseBoilerplate } = await import("@/lib/coding/harness");
    const bp = parseBoilerplate(boiler);
    const cfg: EvalConfig = { executionMode: "function", editableScope: "method", functionSignature: null, templatePrefix: bp.prefix, templateSuffix: bp.suffix, timeLimitMs: 2000, memoryLimitMb: 256, compareMode: "exact", floatTolerance: 1e-6, revealHidden: false };
    const good = `static class MinStack {
        private final Deque<int[]> s = new ArrayDeque<>();
        void push(int x) { s.push(new int[]{x, s.isEmpty() ? x : Math.min(x, s.peek()[1])}); }
        void pop() { s.pop(); }
        int top() { return s.peek()[0]; }
        int getMin() { return s.peek()[1]; }
    }`;
    const tests = [mk("a", "7\npush 2\npush 0\npush 3\ngetMin\npop\ntop\ngetMin", "0\n0\n0"), mk("b", "4\npush -1\npush -5\ngetMin\ntop", "-5\n-5", "hidden")];
    const ok = await evaluate({ config: cfg, tests, studentCode: good, runner });
    expect(ok.compileOutput).toBeNull();
    expect(ok.summary.verdict).toBe("accepted");
    const bad = await evaluate({ config: cfg, tests, studentCode: good.replace("Math.min(x, s.peek()[1])", "x"), runner });
    expect(bad.summary.verdict).not.toBe("accepted");
  });
});
