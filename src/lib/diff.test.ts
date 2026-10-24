import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

describe("diffLines", () => {
  it("identical text has only 'same' lines", () => {
    expect(diffLines("a\nb", "a\nb").every((d) => d.type === "same")).toBe(true);
  });
  it("reports additions and deletions", () => {
    const d = diffLines("a\nb\nc", "a\nx\nc\nd");
    expect(d.filter((x) => x.type === "del").map((x) => x.text)).toEqual(["b"]);
    expect(d.filter((x) => x.type === "add").map((x) => x.text)).toEqual(["x", "d"]);
  });
});
