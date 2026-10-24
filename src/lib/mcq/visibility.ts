import type { QuizSettings } from "./settings";

interface Released {
  results_released_at: string | null;
  answers_released_at: string | null;
}

/** The student sees her score immediately, or once the admin has released results. */
export function canSeeScore(s: Pick<QuizSettings, "show_score">, a: Released): boolean {
  return s.show_score === "immediately" || a.results_released_at !== null;
}

/** Correct answers + explanations: immediately, after release, or never (per quiz setting). */
export function canSeeAnswers(s: Pick<QuizSettings, "show_answers">, a: Released): boolean {
  if (s.show_answers === "never") return false;
  return s.show_answers === "immediately" || a.answers_released_at !== null;
}
