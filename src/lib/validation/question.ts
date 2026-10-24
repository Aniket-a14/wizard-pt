import { z } from "zod";

const text = (max: number) => z.string().max(max);

export const exampleSchema = z.object({
  input: text(20_000).default(""),
  output: text(20_000).default(""),
  explanation: text(5_000).default(""),
});

export const flagSchema = z.object({ field: z.string().max(60), message: z.string().max(300) });

const metadata = {
  title: z.string().trim().min(1, "Title is required").max(200),
  difficulty: z.enum(["easy", "medium", "hard"]).default("easy"),
  topic: text(120).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  company: text(80).default(""),
  statement_md: text(60_000).default(""),
  marks: z.number().min(0).max(1000).default(10),
  explanation_md: text(20_000).default(""),
  review_flags: z.array(flagSchema).max(50).default([]),
  import_id: z.string().uuid().nullable().optional(),
};

export const testCaseSchema = z.object({
  input: text(200_000).default(""),
  expected_output: text(200_000).default(""),
  visibility: z.enum(["public", "hidden"]),
  weight: z.number().min(0.01).max(1000).default(1),
  label: text(80).nullable().optional(),
});

export const codingDraftSchema = z.object({
  questionId: z.string().uuid().nullable(),
  ...metadata,
  input_format: text(10_000).default(""),
  output_format: text(10_000).default(""),
  constraints_md: text(10_000).default(""),
  examples: z.array(exampleSchema).max(20).default([]),
  est_minutes: z.number().int().min(1).max(600).nullable().default(null),
  config: z.object({
    execution_mode: z.enum(["function", "program"]).default("function"),
    grading_mode: z.enum(["auto", "manual"]).default("auto"),
    function_signature: text(500).default(""),
    editable_scope: z.enum(["method", "body"]).default("method"),
    starter_code: text(60_000).default(""),
    time_limit_ms: z.number().int().min(100).max(15_000).default(2000),
    memory_limit_mb: z.number().int().min(32).max(1024).default(256),
    compare_mode: z.enum(["exact", "trim", "tokens", "float"]).default("exact"),
    float_tolerance: z.number().positive().max(1).default(1e-6),
    allow_custom_input: z.boolean().default(true),
    reveal_hidden: z.boolean().default(false),
  }),
  boilerplate_source: text(60_000).default(""),
  reference_solution: text(60_000).default(""),
  tests: z.array(testCaseSchema).max(200).default([]),
});
export type CodingDraftInput = z.input<typeof codingDraftSchema>;
export type CodingDraft = z.output<typeof codingDraftSchema>;

export const mcqDraftSchema = z.object({
  questionId: z.string().uuid().nullable(),
  ...metadata,
  code_snippet: text(20_000).default(""),
  image_path: text(300).nullable().default(null),
  mcq_multi: z.boolean().default(false),
  options: z
    .array(z.object({ text: z.string().trim().min(1, "Option text cannot be empty").max(2_000), correct: z.boolean() }))
    .min(2, "Add at least two options")
    .max(10),
});
export type McqDraftInput = z.input<typeof mcqDraftSchema>;
export type McqDraft = z.output<typeof mcqDraftSchema>;

export const quizDraftSchema = z.object({
  assessmentId: z.string().uuid().nullable(),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: text(5_000).default(""),
  settings: z.unknown(),
  questions: z.array(z.object({ question_id: z.string().uuid(), marks: z.number().min(0).max(1000) })).max(200),
});
export type QuizDraftInput = z.input<typeof quizDraftSchema>;
