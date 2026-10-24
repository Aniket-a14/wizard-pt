import type { SeedProblem } from "../seed/problems";

/**
 * Problem 3 — Scrambled Twin Codes. Statement, signature, formats, constraints and examples are the
 * admin's own text. The hidden tests are generated here; their expected outputs come from an
 * INDEPENDENT implementation (a map of sorted-letter keys), and `pnpm problem:add` additionally
 * requires the Java reference solution to reproduce every one of them in the sandbox before publishing.
 *
 * All test inputs use distinct codes: the statement does not say whether two identical codes count
 * as "twins" ("a different order"), so no test depends on that.
 */

const key = (c: string) => [...c].sort().join("");
function expected(codes: string[]): number {
  if (new Set(codes).size !== codes.length) throw new Error("test input must not contain duplicate codes");
  const groups = new Map<string, number>();
  for (const c of codes) groups.set(key(c), (groups.get(key(c)) ?? 0) + 1);
  return [...groups.values()].filter((n) => n >= 2).reduce((a, b) => a + b, 0);
}
const input = (codes: string[]) => `${codes.length}\n${codes.join(" ")}`;
const test = (label: string, codes: string[]) => ({ input: input(codes), output: String(expected(codes)), label });

// Small deterministic RNG so the large test is reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function permutations(s: string): string[] {
  if (s.length <= 1) return [s];
  return [...s].flatMap((ch, i) => permutations(s.slice(0, i) + s.slice(i + 1)).map((rest) => ch + rest));
}

function largeCodes(): string[] {
  const rand = rng(20261024);
  const word = (len: number) => Array.from({ length: len }, () => A[Math.floor(rand() * 26)]).join("");
  const shuffle = (w: string) => {
    const a = [...w];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.join("");
  };
  const out = new Set<string>();
  // 3,000 base words, 2,000 of which also get a scrambled twin, plus ~3,000 loners  → N = 10,000 exactly.
  const bases: string[] = [];
  while (bases.length < 3000) {
    const w = word(10);
    if (!out.has(w)) { out.add(w); bases.push(w); }
  }
  let twins = 0;
  for (const b of bases) {
    if (twins >= 2000) break;
    const t = shuffle(b);
    if (t !== b && !out.has(t)) { out.add(t); twins++; }
  }
  while (out.size < 10000) out.add(word(10));
  const all = [...out];
  // keep the input order scrambled, so twins are not adjacent
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

const REFERENCE = `public static int countTwinCodes(ArrayList<String> codes) {
    int n = codes.size();
    String[] keys = new String[n];
    for (int i = 0; i < n; i++) {
        char[] letters = codes.get(i).toCharArray();
        Arrays.sort(letters);
        keys[i] = new String(letters);
    }
    Arrays.sort(keys);
    int count = 0;
    int i = 0;
    while (i < n) {
        int j = i;
        while (j < n && keys[j].equals(keys[i])) j++;
        if (j - i >= 2) count += j - i;
        i = j;
    }
    return count;
}`;

const problem: SeedProblem = {
  title: "Scrambled Twin Codes",
  difficulty: "medium",
  topic: "Strings + Sorting",
  company: "Accenture",
  marks: 10,
  statement: `An inventory system at an Accenture client stores product codes in an ArrayList. A data-quality check flags "scrambled twins": codes that use exactly the same letters, just in a different order (for example LISTEN and SILENT).

Count how many codes in the list have at least one scrambled twin elsewhere in the list.`,
  inputFormat: "Line 1: N\nLine 2: N space-separated codes",
  outputFormat: "One integer",
  constraints: `1 <= N <= 10^4
1 <= codes.get(i).length() <= 50
Codes contain only uppercase letters A-Z
Do not use HashMap. Sort the letters of each code (toCharArray + Arrays.sort), then sort the list of sorted codes so that twins end up next to each other.`,
  examples: [
    {
      input: "7\nLISTEN SILENT ENLIST GOOGLE CODE DECO JAVA",
      output: "5",
      explanation: "Sorting the letters of LISTEN, SILENT and ENLIST gives EILNST for all three, and CODE and DECO both give CDEO, so 3 + 2 = 5 codes have a twin. GOOGLE and JAVA have none.",
    },
    { input: "3\nABC DEF GHI", output: "0" },
    {
      input: "4\nAAB ABA BAA AB",
      output: "3",
      explanation: "AB is not a twin of AAB, because the letter counts differ.",
    },
  ],
  mode: "function",
  signature: "public static int countTwinCodes(ArrayList<String> codes)",
  compare: "exact",
  reference: REFERENCE,
  publicTests: [
    { input: "7\nLISTEN SILENT ENLIST GOOGLE CODE DECO JAVA", output: "5" },
    { input: "3\nABC DEF GHI", output: "0" },
    { input: "4\nAAB ABA BAA AB", output: "3" },
  ],
  hiddenTests: [
    test("single code", ["A"]),
    test("one pair", ["AB", "BA"]),
    test("two groups and a loner", ["AB", "BA", "ABC", "CBA", "BAC", "CAB", "ZZ"]),
    test("twins are not adjacent in the input", ["LISTEN", "GOOGLE", "SILENT", "CODE", "ENLIST", "DECO", "JAVA"]),
    test("no twins at all", ["A", "B", "C", "D", "E"]),
    test("all 26 single letters", [...A]),
    test("same letters, different counts", ["AAB", "ABB", "ABA", "BAB", "BBA", "AAAB"]),
    test("groups of 3 and 2 with a loner", ["TAR", "RAT", "ART", "CAT", "ACT", "TAC", "DOG", "GOD", "BIRD"]),
    test("palindrome-like codes", ["ABA", "BAA", "AAB", "ABBA", "BABA", "BAAB"]),
    test("everyone is a twin (all 24 permutations of ABCD)", permutations("ABCD")),
    test("longest codes (50 letters)", ["Z".repeat(25) + "A".repeat(25), "A".repeat(25) + "Z".repeat(25), "A".repeat(24) + "Z".repeat(26)]),
    test("maximum N = 10,000", largeCodes()),
  ],
};

export default problem;
