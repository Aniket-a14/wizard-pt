import type { QuizSettings } from "./settings";

export interface McqGradeInput {
  selected: string[];
  correct: string[];
  marks: number;
  multi: boolean;
}

export interface McqGrade {
  answered: boolean;
  isCorrect: boolean;
  awarded: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Grade one MCQ.
 *  - Unanswered: 0 marks, never penalised.
 *  - Single answer: right = full marks; wrong = 0 (or −penalty when negative marking is on).
 *  - Multiple answers: exact set match = full marks. Otherwise 0 / −penalty, unless
 *    `partial_multi` is on: credit = max(0, (right picks − wrong picks) / #correct) × marks.
 */
export function gradeMcq(q: McqGradeInput, s: Pick<QuizSettings, "negative_marking" | "partial_multi">): McqGrade {
  const selected = [...new Set(q.selected)];
  if (selected.length === 0) return { answered: false, isCorrect: false, awarded: 0 };

  const correctSet = new Set(q.correct);
  const right = selected.filter((id) => correctSet.has(id)).length;
  const wrong = selected.length - right;
  const exact = wrong === 0 && right === correctSet.size;
  if (exact) return { answered: true, isCorrect: true, awarded: r2(q.marks) };

  if (q.multi && s.partial_multi && right > wrong) {
    const frac = Math.max(0, (right - wrong) / Math.max(1, correctSet.size));
    return { answered: true, isCorrect: false, awarded: r2(q.marks * frac) };
  }
  const penalty = s.negative_marking.enabled ? r2(q.marks * s.negative_marking.penalty_fraction) : 0;
  return { answered: true, isCorrect: false, awarded: penalty === 0 ? 0 : -penalty };
}

export interface QuizTotals {
  score: number;
  maxScore: number;
  correct: number;
  incorrect: number;
  unanswered: number;
}

/** Total score is clamped at zero so negative marking can't produce a negative result. */
export function totalise(grades: { grade: McqGrade; marks: number }[]): QuizTotals {
  const maxScore = r2(grades.reduce((a, g) => a + g.marks, 0));
  const raw = grades.reduce((a, g) => a + g.grade.awarded, 0);
  return {
    score: Math.max(0, r2(raw)),
    maxScore,
    correct: grades.filter((g) => g.grade.isCorrect).length,
    incorrect: grades.filter((g) => g.grade.answered && !g.grade.isCorrect).length,
    unanswered: grades.filter((g) => !g.grade.answered).length,
  };
}

/** Deterministic Fisher–Yates using a seed so a student's shuffled order is stable across refreshes. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const rand = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
