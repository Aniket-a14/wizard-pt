import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EvalConfig, EvalTest } from "./evaluate";

export interface EvalContext {
  versionId: string;
  questionId: string;
  title: string;
  marks: number;
  gradingMode: "auto" | "manual";
  allowCustomInput: boolean;
  config: EvalConfig;
  tests: EvalTest[];
  referenceSolution: string | null;
}

/**
 * Load everything needed to grade a version, INCLUDING trusted wrapper code and hidden tests.
 * Uses the service role: callers must already have authorised the user. Never return this
 * object (or any part of it other than public data) to a browser.
 */
export async function loadEvalContext(versionId: string): Promise<EvalContext | null> {
  const db = createAdminClient();
  const [v, cfg, sec, tests] = await Promise.all([
    db.from("question_versions").select("id, question_id, title, marks, published_at").eq("id", versionId).maybeSingle(),
    db.from("coding_configs").select("*").eq("question_version_id", versionId).maybeSingle(),
    db.from("coding_secrets").select("*").eq("question_version_id", versionId).maybeSingle(),
    db.from("test_cases").select("id, input, expected_output, visibility, weight, ordering, label").eq("question_version_id", versionId).order("ordering"),
  ]);
  if (!v.data || !cfg.data || !sec.data) return null;
  return {
    versionId,
    questionId: v.data.question_id,
    title: v.data.title,
    marks: Number(v.data.marks),
    gradingMode: cfg.data.grading_mode as "auto" | "manual",
    allowCustomInput: cfg.data.allow_custom_input,
    referenceSolution: sec.data.reference_solution,
    config: {
      executionMode: cfg.data.execution_mode as "function" | "program",
      editableScope: cfg.data.editable_scope as "method" | "body",
      functionSignature: cfg.data.function_signature,
      templatePrefix: sec.data.template_prefix,
      templateSuffix: sec.data.template_suffix,
      timeLimitMs: cfg.data.time_limit_ms,
      memoryLimitMb: cfg.data.memory_limit_mb,
      compareMode: cfg.data.compare_mode as EvalConfig["compareMode"],
      floatTolerance: cfg.data.float_tolerance,
      revealHidden: cfg.data.reveal_hidden,
    },
    tests: (tests.data ?? []).map((t) => ({
      id: t.id,
      input: t.input,
      expectedOutput: t.expected_output,
      visibility: t.visibility as "public" | "hidden",
      weight: Number(t.weight),
      label: t.label,
    })),
  };
}
