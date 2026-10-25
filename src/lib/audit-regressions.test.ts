import { describe, expect, it } from "vitest";
import { compareOutput } from "./coding/compare";
import { requestIdentity } from "./idempotency";
import { parseQuestions, stripPageNoise, type ParsedCoding } from "./import/text-parser";

describe("audit regressions", () => {
  it("preserves numeric examples while removing explicit PDF page labels", () => {
    const text = "Problem 1 - Count\nCount the entries.\nExample 1\nInput:\n3\na b c\nOutput:\n3\nPage 1 of 2\n2 / 2";
    const cleaned = stripPageNoise(text);
    const q = parseQuestions(cleaned).questions[0] as ParsedCoding;
    expect(q.examples[0]).toMatchObject({ input: "3\na b c", output: "3" });
    expect(cleaned).not.toContain("Page 1");
    expect(cleaned).not.toContain("2 / 2");
  });

  it("retains a retry key for one snapshot and changes it for revised code", () => {
    const first = requestIdentity(null, JSON.stringify({ code: "old" }));
    expect(requestIdentity(first, first.snapshot)).toBe(first);
    const revised = requestIdentity(first, JSON.stringify({ code: "new" }));
    expect(revised.key).not.toBe(first.key);
    expect(requestIdentity(first, JSON.stringify({ code: "old", language: "cpp" })).key).not.toBe(first.key);
  });

  it("compares unordered numeric notation and precision without depending on text order", () => {
    const unordered = { mode: "unordered" as const };
    expect(compareOutput("[0.1,0.2]", "[1e-1,0.2]", unordered).ok).toBe(true);
    expect(compareOutput("[10.0,2.0]", "[9.9999999,2.0]", unordered).ok).toBe(true);
    expect(compareOutput("[9223372036854775806,9223372036854775807]", "[9223372036854775807,9223372036854775806]", unordered).ok).toBe(true);
    expect(compareOutput("[9223372036854775806]", "[9223372036854775807]", unordered).ok).toBe(false);
    expect(compareOutput("[0.1,0.1]", "[0.1,0.2]", unordered).ok).toBe(false);
  });

  it("finds a complete matching for overlapping structured numeric tolerances", () => {
    expect(compareOutput("[[1.0],[1.15]]", "[[1.0],[0.9]]", { mode: "unordered", floatTolerance: 0.15 }).ok).toBe(true);
    expect(compareOutput("[[2,1],[4,3]]", "[[3,4],[1,2]]", { mode: "unordered_deep" }).ok).toBe(true);
    expect(compareOutput("[[2,1],[4,3]]", "[[3,4],[1,2]]", { mode: "unordered" }).ok).toBe(false);
    expect(compareOutput('{"x":[0.1,0.2]}', '{"x":[0.2,1e-1]}', { mode: "unordered_deep" }).ok).toBe(true);
  });
});
