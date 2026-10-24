import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DockerRunner } from "@/lib/runner/docker";
import { evaluate, evaluateCustom, type EvalConfig, type EvalTest } from "@/lib/coding/evaluate";
import { buildCTemplate } from "@/lib/coding/harness-c";
import { buildCppTemplate } from "@/lib/coding/harness-cpp";
import { parseSignature } from "@/lib/coding/signature";
import type { Lang } from "@/lib/coding/languages";
import type { Runner } from "@/lib/runner/types";

/**
 * Real C++ / C compile-and-run through the Docker sandbox, with the same typed signature and the same
 * stdin/stdout encodings as Java, so one set of tests serves every language.
 */
const GCC = process.env.RUNNER_DOCKER_GCC_IMAGE ?? "gcc:14";
const JDK = process.env.RUNNER_DOCKER_IMAGE ?? "eclipse-temurin:21-jdk";
function have(image: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", image], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const ready = have(GCC);
const runner: Runner = new DockerRunner({ image: JDK, gccImage: GCC, parallelism: 6 });

function cfgFor(lang: "cpp" | "c", signature: string, extra: Partial<EvalConfig> = {}): EvalConfig {
  const sig = parseSignature(signature);
  const tpl = lang === "cpp" ? buildCppTemplate(sig) : buildCTemplate(sig);
  return {
    language: lang,
    executionMode: "function",
    editableScope: "method",
    functionSignature: tpl.declaration,
    templatePrefix: tpl.prefix,
    templateSuffix: tpl.suffix,
    timeLimitMs: 2000,
    memoryLimitMb: 128,
    compareMode: "exact",
    floatTolerance: 1e-6,
    revealHidden: false,
    ...extra,
  };
}
const mk = (id: string, input: string, expectedOutput: string, visibility: "public" | "hidden" = "public"): EvalTest => ({ id, input, expectedOutput, visibility, weight: 1 });

async function runCase(lang: "cpp" | "c", c: { sig: string; code: string; input: string; expect: string }) {
  return evaluate({ config: cfgFor(lang, c.sig, { compareMode: "exact" }), tests: [mk("t", c.input, c.expect)], studentCode: c.code, runner });
}

const CPP_CASES: { name: string; sig: string; code: string; input: string; expect: string }[] = [
  { name: "List<String> param, int", sig: "public static int countTwinCodes(ArrayList<String> codes)", input: "7\nLISTEN SILENT ENLIST GOOGLE CODE DECO JAVA",
    code: `int countTwinCodes(vector<string>& codes) { map<string,int> m; for (auto c : codes) { sort(c.begin(), c.end()); m[c]++; } int r = 0; for (auto& kv : m) if (kv.second > 1) r += kv.second; return r; }`, expect: "5" },
  { name: "String->String", sig: "public static String maskCode(String code)", input: "AB-12-CD",
    code: `string maskCode(string code) { string l; for (char c : code) if (isalpha(c)) l += c; reverse(l.begin(), l.end()); int k = 0; for (char& c : code) if (isalpha(c)) c = l[k++]; return code; }`, expect: "DC-12-BA" },
  { name: "int[] + int -> int[]", sig: "public static int[] twoSum(int[] nums, int target)", input: "2 7 11 15\n9",
    code: `vector<int> twoSum(vector<int>& nums, int target) { for (int i = 0; i < (int)nums.size(); i++) for (int j = i + 1; j < (int)nums.size(); j++) if (nums[i] + nums[j] == target) return {i, j}; return {}; }`, expect: "0 1" },
  { name: "double return 2.5", sig: "public static double average(int[] a)", input: "1 2 3 4",
    code: `double average(vector<int>& a) { double s = 0; for (int x : a) s += x; return s / a.size(); }`, expect: "2.5" },
  { name: "double return 100.0", sig: "public static double average(int[] a)", input: "100 100",
    code: `double average(vector<int>& a) { double s = 0; for (int x : a) s += x; return s / a.size(); }`, expect: "100.0" },
  { name: "double sci 1.0E7 / 1.0E-4", sig: "public static double[] vals(int n)", input: "0",
    code: `vector<double> vals(int n) { return {1e7, 1e-4, 0.1+0.2, 123456.789, 3.0}; }`, expect: "1.0E7 1.0E-4 0.30000000000000004 123456.789 3.0" },
  { name: "List<List<Integer>> json", sig: "public static List<List<Integer>> subsets(int[] nums)", input: "1 2",
    code: `vector<vector<int>> subsets(vector<int>& nums) { vector<vector<int>> r = {{}}; for (int x : nums) { int n = r.size(); for (int i = 0; i < n; i++) { auto v = r[i]; v.push_back(x); r.push_back(v); } } return r; }`, expect: "[[],[1],[2],[1,2]]" },
  { name: "Map<String,Integer> json (sorted)", sig: "public static Map<String,Integer> countWords(String[] words)", input: "4\nb\na\nb\nc",
    code: `map<string,int> countWords(vector<string>& w) { map<string,int> m; for (auto& s : w) m[s]++; return m; }`, expect: '{"a":1,"b":2,"c":1}' },
  { name: "void int[][] in place", sig: "public static void rotate(int[][] m)", input: "2\n1 2\n3 4",
    code: `void rotate(vector<vector<int>>& m) { int n = m.size(); for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) swap(m[i][j], m[j][i]); for (auto& r : m) reverse(r.begin(), r.end()); }`, expect: "3 1\n4 2" },
  { name: "ListNode reverse", sig: "public static ListNode reverseList(ListNode head)", input: "[1,2,3]",
    code: `ListNode* reverseList(ListNode* head) { ListNode* prev = nullptr; while (head) { ListNode* n = head->next; head->next = prev; prev = head; head = n; } return prev; }`, expect: "[3,2,1]" },
  { name: "TreeNode depth", sig: "public static int maxDepth(TreeNode root)", input: "[3,9,20,null,null,15,7]",
    code: `int maxDepth(TreeNode* r) { return r ? 1 + max(maxDepth(r->left), maxDepth(r->right)) : 0; }`, expect: "3" },
  { name: "TreeNode invert", sig: "public static TreeNode invert(TreeNode root)", input: "[4,2,7,1,3,6,9]",
    code: `TreeNode* invert(TreeNode* r) { if (!r) return r; swap(r->left, r->right); invert(r->left); invert(r->right); return r; }`, expect: "[4,7,2,9,6,3,1]" },
  { name: "boolean", sig: "public static boolean isPalin(String s)", input: "racecar",
    code: `bool isPalin(string s) { string t = s; reverse(t.begin(), t.end()); return s == t; }`, expect: "true" },
  { name: "long", sig: "public static long fact(int n)", input: "20",
    code: `long long fact(int n) { long long r = 1; for (int i = 2; i <= n; i++) r *= i; return r; }`, expect: "2432902008176640000" },
  { name: "char return + char param", sig: "public static char next(char c)", input: "a",
    code: `char next(char c) { return c + 1; }`, expect: "b" },
  { name: "Set<Integer> out sorted", sig: "public static Set<Integer> uniq(int[] a)", input: "5 3 5 1",
    code: `set<int> uniq(vector<int>& a) { return set<int>(a.begin(), a.end()); }`, expect: "1 3 5" },
  { name: "char[][] -> char[][]", sig: "public static char[][] flip(char[][] g)", input: "2\nab\ncd",
    code: `vector<vector<char>> flip(vector<vector<char>>& g) { reverse(g.begin(), g.end()); return g; }`, expect: "cd\nab" },
  { name: "List<String> out (per line)", sig: "public static List<String> two(String s)", input: "ab",
    code: `vector<string> two(string s) { return {s, string(s.rbegin(), s.rend())}; }`, expect: "ab\nba" },
  { name: "String[] in/out", sig: "public static String[] upper(String[] a)", input: "2\nhello world\nx",
    code: `vector<string> upper(vector<string>& a) { for (auto& s : a) for (char& c : s) c = toupper(c); return a; }`, expect: "HELLO WORLD\nX" },
  { name: "student cout output + result", sig: "public static int one()", input: "",
    code: `int one() { cout << "debug line"; return 1; }`, expect: "1" },
  { name: "List<Integer> items in, long out", sig: "public static long sum(List<Integer> xs)", input: "3\n1 2 3",
    code: `long long sum(vector<int>& xs) { long long s = 0; for (int x : xs) s += x; return s; }`, expect: "6" },
  { name: "Map<Character,Integer> in json", sig: "public static int total(Map<Character,Integer> m)", input: '{"a":1,"b":2}',
    code: `int total(map<char,int>& m) { int s = 0; for (auto& kv : m) s += kv.second; return s; }`, expect: "3" },
  { name: "boolean[] out", sig: "public static boolean[] flags(int n)", input: "3",
    code: `vector<bool> flags(int n) { vector<bool> r; for (int i = 0; i < n; i++) r.push_back(i % 2 == 0); return r; }`, expect: "true false true" },
];

const C_CASES: { name: string; sig: string; code: string; input: string; expect: string }[] = [
  { name: "int sum of int[]", sig: "public static int sum(int[] a)", input: "1 2 3 4",
    code: `int sum(int* a, int aSize) { int s = 0; for (int i = 0; i < aSize; i++) s += a[i]; return s; }`, expect: "10" },
  { name: "String->String", sig: "public static String maskCode(String code)", input: "AB-12-CD",
    code: `char* maskCode(char* code) { int n = strlen(code); char* r = malloc(n + 1); strcpy(r, code); int i = 0, j = n - 1; while (i < j) { while (i < j && !isalpha(r[i])) i++; while (i < j && !isalpha(r[j])) j--; if (i < j) { char t = r[i]; r[i] = r[j]; r[j] = t; i++; j--; } } return r; }`, expect: "DC-12-BA" },
  { name: "twoSum int[] -> int[]", sig: "public static int[] twoSum(int[] nums, int target)", input: "2 7 11 15\n9",
    code: `int* twoSum(int* nums, int numsSize, int target, int* returnSize) { int* r = malloc(2 * sizeof(int)); for (int i = 0; i < numsSize; i++) for (int j = i + 1; j < numsSize; j++) if (nums[i] + nums[j] == target) { r[0] = i; r[1] = j; *returnSize = 2; return r; } *returnSize = 0; return r; }`, expect: "0 1" },
  { name: "double 2.5", sig: "public static double average(int[] a)", input: "1 2 3 4",
    code: `double average(int* a, int aSize) { double s = 0; for (int i = 0; i < aSize; i++) s += a[i]; return s / aSize; }`, expect: "2.5" },
  { name: "double[] formats", sig: "public static double[] vals(int n)", input: "0",
    code: `double* vals(int n, int* returnSize) { double* r = malloc(5 * sizeof(double)); r[0]=1e7; r[1]=1e-4; r[2]=0.1+0.2; r[3]=123456.789; r[4]=3.0; *returnSize = 5; return r; }`, expect: "1.0E7 1.0E-4 0.30000000000000004 123456.789 3.0" },
  { name: "void int[][] in place", sig: "public static void rotate(int[][] m)", input: "2\n1 2\n3 4",
    code: `void rotate(int** m, int mSize, int* mColSize) { int n = mSize; for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) { int t = m[i][j]; m[i][j] = m[j][i]; m[j][i] = t; } for (int i = 0; i < n; i++) for (int j = 0; j < n / 2; j++) { int t = m[i][j]; m[i][j] = m[i][n-1-j]; m[i][n-1-j] = t; } }`, expect: "3 1\n4 2" },
  { name: "int[][] returned", sig: "public static int[][] pairs(int n)", input: "3",
    code: `int** pairs(int n, int* returnSize, int** returnColumnSizes) { int** r = malloc(n * sizeof(int*)); *returnColumnSizes = malloc(n * sizeof(int)); for (int i = 0; i < n; i++) { r[i] = malloc(2 * sizeof(int)); r[i][0] = i; r[i][1] = i * i; (*returnColumnSizes)[i] = 2; } *returnSize = n; return r; }`, expect: "0 0\n1 1\n2 4" },
  { name: "ListNode reverse", sig: "public static ListNode reverseList(ListNode head)", input: "[1,2,3]",
    code: `struct ListNode* reverseList(struct ListNode* head) { struct ListNode* prev = 0; while (head) { struct ListNode* n = head->next; head->next = prev; prev = head; head = n; } return prev; }`, expect: "[3,2,1]" },
  { name: "ListNode empty", sig: "public static ListNode reverseList(ListNode head)", input: "[]",
    code: `struct ListNode* reverseList(struct ListNode* head) { return head; }`, expect: "[]" },
  { name: "TreeNode depth", sig: "public static int maxDepth(TreeNode root)", input: "[3,9,20,null,null,15,7]",
    code: `int maxDepth(struct TreeNode* r) { if (!r) return 0; int a = maxDepth(r->left), b = maxDepth(r->right); return 1 + (a > b ? a : b); }`, expect: "3" },
  { name: "TreeNode invert", sig: "public static TreeNode invert(TreeNode root)", input: "[4,2,7,1,3,6,9]",
    code: `struct TreeNode* invert(struct TreeNode* r) { if (!r) return r; struct TreeNode* t = r->left; r->left = invert(r->right); r->right = invert(t); return r; }`, expect: "[4,7,2,9,6,3,1]" },
  { name: "boolean", sig: "public static boolean isPalin(String s)", input: "racecar",
    code: `bool isPalin(char* s) { int n = strlen(s); for (int i = 0; i < n / 2; i++) if (s[i] != s[n-1-i]) return false; return true; }`, expect: "true" },
  { name: "long", sig: "public static long fact(int n)", input: "20",
    code: `long long fact(int n) { long long r = 1; for (int i = 2; i <= n; i++) r *= i; return r; }`, expect: "2432902008176640000" },
  { name: "char", sig: "public static char next(char c)", input: "a",
    code: `char next(char c) { return c + 1; }`, expect: "b" },
  { name: "String[] in/out", sig: "public static String[] upper(String[] a)", input: "2\nhello world\nx",
    code: `char** upper(char** a, int aSize, int* returnSize) { for (int i = 0; i < aSize; i++) for (char* p = a[i]; *p; p++) *p = toupper(*p); *returnSize = aSize; return a; }`, expect: "HELLO WORLD\nX" },
  { name: "char[] in place (reverse)", sig: "public static void reverseString(char[] s)", input: "hello",
    code: `void reverseString(char* s, int sSize) { for (int i = 0, j = sSize - 1; i < j; i++, j--) { char t = s[i]; s[i] = s[j]; s[j] = t; } }`, expect: "olleh" },
  { name: "char[][] grid in/out", sig: "public static char[][] flip(char[][] g)", input: "2\nab\ncd",
    code: `char** flip(char** g, int gSize, int* gColSize, int* returnSize, int** returnColumnSizes) { char** r = malloc(gSize * sizeof(char*)); *returnColumnSizes = malloc(gSize * sizeof(int)); for (int i = 0; i < gSize; i++) { r[i] = g[gSize - 1 - i]; (*returnColumnSizes)[i] = gColSize[gSize - 1 - i]; } *returnSize = gSize; return r; }`, expect: "cd\nab" },
  { name: "boolean[] out", sig: "public static boolean[] flags(int n)", input: "3",
    code: `bool* flags(int n, int* returnSize) { bool* r = malloc(n); for (int i = 0; i < n; i++) r[i] = i % 2 == 0; *returnSize = n; return r; }`, expect: "true false true" },
  { name: "student printf output", sig: "public static int one()", input: "",
    code: `int one() { printf("debug"); return 1; }`, expect: "1" },
  { name: "empty int[]", sig: "public static int sum(int[] a)", input: "",
    code: `int sum(int* a, int aSize) { return aSize; }`, expect: "0" },
];

describe.skipIf(!ready)("C++ function-mode harness (real g++)", () => {
  it.each(CPP_CASES)("$name", async (c) => {
    const r = await runCase("cpp", c);
    expect(r.compileOutput).toBeNull();
    expect(r.summary.verdict).toBe("accepted");
  }, 120_000);
});

describe.skipIf(!ready)("C function-mode harness (real gcc)", () => {
  it.each(C_CASES)("$name", async (c) => {
    const r = await runCase("c", c);
    expect(r.compileOutput).toBeNull();
    expect(r.summary.verdict).toBe("accepted");
  }, 120_000);
});

describe.skipIf(!ready)("C / C++ through the evaluation pipeline", () => {
  const SIG = "public static int countTwinCodes(ArrayList<String> codes)";
  const TESTS: EvalTest[] = [
    mk("p1", "7\nLISTEN SILENT ENLIST GOOGLE CODE DECO JAVA", "5"),
    mk("p2", "3\nABC DEF GHI", "0"),
    mk("h1", "1\nA", "0", "hidden"),
    mk("h2", "2\nAB BA", "2", "hidden"),
  ];
  const CPP_OK = "int countTwinCodes(vector<string>& codes) { map<string,int> m; for (auto c : codes) { sort(c.begin(), c.end()); m[c]++; } int r = 0; for (auto& kv : m) if (kv.second > 1) r += kv.second; return r; }";

  it("ignores a main() the student pasted along with the function (the whole file she tested elsewhere)", async () => {
    const pasted = `${CPP_OK}\n\nint main() {\n  int n; cin >> n; vector<string> v(n); for (auto& s : v) cin >> s;\n  cout << countTwinCodes(v) << endl;\n}\n`;
    const r = await evaluate({ config: cfgFor("cpp", SIG), tests: TESTS, studentCode: pasted, runner });
    expect(r.compileOutput).toBeNull();
    expect(r.summary.verdict).toBe("accepted");
    expect(r.summary.scorePct).toBe(100);
  }, 120_000);

  it("reports a wrong answer without leaking hidden tests", async () => {
    const wrong = "int countTwinCodes(vector<string>& codes) { return 0; }";
    const r = await evaluate({ config: cfgFor("cpp", SIG), tests: TESTS, studentCode: wrong, runner });
    expect(r.summary.verdict).toBe("partial");
    expect(r.student.filter((x) => x.visibility === "hidden").every((x) => x.input === undefined && x.expected === undefined)).toBe(true);
  }, 120_000);

  it("maps g++ compile errors to the student's own line numbers", async () => {
    const bad = "int countTwinCodes(vector<string>& codes) {\n  int x = ;\n  return 0;\n}";
    const r = await evaluate({ config: cfgFor("cpp", SIG), tests: TESTS, studentCode: bad, runner });
    expect(r.summary.verdict).toBe("compile_error");
    expect(r.compileOutput).toMatch(/Line 2/);
    expect(r.compileOutput).not.toMatch(/main\.cpp:\d/);
  }, 120_000);

  it("maps gcc compile errors for C too", async () => {
    const cfg = cfgFor("c", "public static int sum(int[] a)");
    const r = await evaluate({ config: cfg, tests: [mk("p", "1 2", "3")], studentCode: "int sum(int* a, int aSize) {\n  return a[0] + ;\n}", runner });
    expect(r.summary.verdict).toBe("compile_error");
    expect(r.compileOutput).toMatch(/Line 2/);
  }, 120_000);

  it("classifies crashes, infinite loops and memory hogs", async () => {
    const sig = "public static int f(int n)";
    const run = (lang: "cpp" | "c", code: string) => evaluate({ config: cfgFor(lang, sig, { timeLimitMs: 1000, memoryLimitMb: 48 }), tests: [mk("t", "1", "1")], studentCode: code, runner });
    expect((await run("cpp", "int f(int n) { int* p = nullptr; return *p; }")).student[0].status).toBe("runtime_error");
    expect((await run("c", "int f(int n) { int* p = 0; return *p; }")).student[0].status).toBe("runtime_error");
    expect((await run("cpp", "int f(int n) { for (;;) {} return 0; }")).student[0].status).toBe("time_limit");
    expect((await run("c", "int f(int n) { for (;;) {} return 0; }")).student[0].status).toBe("time_limit");
    expect((await run("cpp", "int f(int n) { vector<char> v; for (;;) v.resize(v.size() + (1 << 22), 1); return 0; }")).student[0].status).toBe("memory_limit");
  }, 180_000);

  it("deep recursion works (64 MB stack)", async () => {
    const r = await evaluate({ config: cfgFor("cpp", "public static int f(int n)"), tests: [mk("t", "300000", "300000")], studentCode: "int f(int n) { return n == 0 ? 0 : 1 + f(n - 1); }", runner });
    expect(r.summary.verdict).toBe("accepted");
  }, 120_000);

  it("custom input run reports the returned value", async () => {
    const out = await evaluateCustom({ config: cfgFor("cpp", SIG), input: "2\nAB BA", studentCode: CPP_OK, runner });
    expect(out.status).toBe("ok");
    expect(out.output).toBe("2");
  }, 120_000);

  it("full-program mode works in C and C++", async () => {
    const mkProg = (lang: Lang): EvalConfig => ({ language: lang, executionMode: "program", editableScope: "method", functionSignature: null, templatePrefix: "", templateSuffix: "", timeLimitMs: 2000, memoryLimitMb: 128, compareMode: "exact", floatTolerance: 1e-6, revealHidden: false });
    const cpp = await evaluate({ config: mkProg("cpp"), tests: [mk("t", "3 4", "7")], studentCode: "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;}", runner });
    expect(cpp.summary.verdict).toBe("accepted");
    const c = await evaluate({ config: mkProg("c"), tests: [mk("t", "3 4", "12")], studentCode: "#include <stdio.h>\nint main(void){int a,b;scanf(\"%d %d\",&a,&b);printf(\"%d\\n\",a*b);return 0;}", runner });
    expect(c.summary.verdict).toBe("accepted");
  }, 120_000);
});
