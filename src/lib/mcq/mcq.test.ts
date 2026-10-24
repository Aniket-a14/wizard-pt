import { describe, expect, it } from "vitest";
import { gradeMcq, totalise, seededShuffle } from "./grade";
import { parseQuizSettings } from "./settings";

const off = { negative_marking: { enabled: false, penalty_fraction: 0.25 }, partial_multi: false };
const neg = { negative_marking: { enabled: true, penalty_fraction: 0.25 }, partial_multi: false };

describe("gradeMcq", () => {
  const single = { correct: ["b"], marks: 4, multi: false };
  it("correct / incorrect / unanswered (single)", () => {
    expect(gradeMcq({ ...single, selected: ["b"] }, off)).toEqual({ answered: true, isCorrect: true, awarded: 4 });
    expect(gradeMcq({ ...single, selected: ["a"] }, off)).toEqual({ answered: true, isCorrect: false, awarded: 0 });
    expect(gradeMcq({ ...single, selected: [] }, neg)).toEqual({ answered: false, isCorrect: false, awarded: 0 });
  });
  it("negative marking only when configured, never for unanswered", () => {
    expect(gradeMcq({ ...single, selected: ["a"] }, neg).awarded).toBe(-1);
    expect(gradeMcq({ ...single, selected: ["a"] }, off).awarded).toBe(0);
  });
  it("multi-answer is all-or-nothing by default", () => {
    const m = { correct: ["a", "c"], marks: 2, multi: true };
    expect(gradeMcq({ ...m, selected: ["a", "c"] }, off).awarded).toBe(2);
    expect(gradeMcq({ ...m, selected: ["a"] }, off).awarded).toBe(0);
    expect(gradeMcq({ ...m, selected: ["a", "b", "c"] }, off).isCorrect).toBe(false);
    expect(gradeMcq({ ...m, selected: ["a"] }, neg).awarded).toBe(-0.5);
  });
  it("multi-answer partial credit when enabled", () => {
    const s = { ...off, partial_multi: true };
    const m = { correct: ["a", "c"], marks: 2, multi: true };
    expect(gradeMcq({ ...m, selected: ["a"] }, s).awarded).toBe(1);
    expect(gradeMcq({ ...m, selected: ["a", "b"] }, s).awarded).toBe(0); // right == wrong → no credit
  });
  it("totals clamp at zero", () => {
    const g = [
      { grade: gradeMcq({ ...single, selected: ["a"] }, neg), marks: 4 },
      { grade: gradeMcq({ ...single, selected: [] }, neg), marks: 4 },
    ];
    const t = totalise(g);
    expect(t).toEqual({ score: 0, maxScore: 8, correct: 0, incorrect: 1, unanswered: 1 });
  });
});

describe("settings + shuffle", () => {
  it("applies defaults and validates", () => {
    const s = parseQuizSettings({});
    expect(s.max_attempts).toBe(1);
    expect(s.negative_marking.enabled).toBe(false);
    expect(s.show_answers).toBe("after_release");
    expect(() => parseQuizSettings({ max_attempts: 0 })).toThrow();
  });
  it("seeded shuffle is stable and a permutation", () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6], "seed");
    expect(seededShuffle([1, 2, 3, 4, 5, 6], "seed")).toEqual(a);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

import { canSeeAnswers, canSeeScore } from "./visibility";
describe("result visibility", () => {
  const none = { results_released_at: null, answers_released_at: null };
  const rel = { results_released_at: "2026-01-01", answers_released_at: "2026-01-01" };
  it("score", () => {
    expect(canSeeScore({ show_score: "immediately" }, none)).toBe(true);
    expect(canSeeScore({ show_score: "after_release" }, none)).toBe(false);
    expect(canSeeScore({ show_score: "after_release" }, rel)).toBe(true);
  });
  it("answers", () => {
    expect(canSeeAnswers({ show_answers: "immediately" }, none)).toBe(true);
    expect(canSeeAnswers({ show_answers: "after_release" }, none)).toBe(false);
    expect(canSeeAnswers({ show_answers: "after_release" }, rel)).toBe(true);
    expect(canSeeAnswers({ show_answers: "never" }, rel)).toBe(false);
  });
});
