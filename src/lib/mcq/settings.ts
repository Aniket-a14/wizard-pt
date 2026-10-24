import { z } from "zod";

export const quizSettingsSchema = z.object({
  timer_minutes: z.number().int().min(1).max(600).nullable().default(null),
  max_attempts: z.number().int().min(1).max(20).default(1),
  negative_marking: z
    .object({
      enabled: z.boolean().default(false),
      /** Fraction of a question's marks deducted for a wrong answer, e.g. 0.25. */
      penalty_fraction: z.number().min(0).max(1).default(0.25),
    })
    .default({ enabled: false, penalty_fraction: 0.25 }),
  partial_multi: z.boolean().default(false),
  shuffle_questions: z.boolean().default(false),
  shuffle_options: z.boolean().default(false),
  /** When the student sees her score. */
  show_score: z.enum(["immediately", "after_release"]).default("immediately"),
  /** When the student sees correct answers + explanations. */
  show_answers: z.enum(["immediately", "after_release", "never"]).default("after_release"),
});

export type QuizSettings = z.infer<typeof quizSettingsSchema>;

export function parseQuizSettings(raw: unknown): QuizSettings {
  return quizSettingsSchema.parse(raw ?? {});
}
