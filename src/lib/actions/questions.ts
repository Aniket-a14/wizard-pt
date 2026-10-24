"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareCoding } from "@/lib/coding/prepare";
import type { Lang } from "@/lib/coding/languages";
import { loadEvalContext } from "@/lib/coding/context";
import { evaluate } from "@/lib/coding/evaluate";
import { checkTestInputShape, parseSignature } from "@/lib/coding/signature";
import { getRunner } from "@/lib/runner";
import { codingDraftSchema, mcqDraftSchema, type CodingDraftInput, type McqDraftInput } from "@/lib/validation/question";
import { toActionError, zodFieldErrors, type ActionResult } from "./common";
import type { Json } from "@/lib/supabase/database.types";

export async function saveCodingDraft(input: CodingDraftInput): Promise<ActionResult<{ questionId: string; versionId: string; warnings: string[] }>> {
  try {
    await assertAdmin();
    const parsed = codingDraftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, fieldErrors: zodFieldErrors(parsed.error.issues) };
    const prepared = prepareCoding(parsed.data);
    if (!prepared.ok) return prepared;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_coding_draft", {
      p_payload: prepared.payload as Json,
      p_question_id: parsed.data.questionId ?? undefined,
    });
    if (error) throw error;
    const r = data as unknown as { question_id: string; version_id: string };
    revalidatePath("/admin/questions");
    return { ok: true, questionId: r.question_id, versionId: r.version_id, warnings: prepared.warnings };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveMcqDraft(input: McqDraftInput): Promise<ActionResult<{ questionId: string; versionId: string }>> {
  try {
    await assertAdmin();
    const parsed = mcqDraftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, fieldErrors: zodFieldErrors(parsed.error.issues) };
    const d = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_mcq_draft", {
      p_question_id: d.questionId ?? undefined,
      p_payload: {
        title: d.title,
        difficulty: d.difficulty,
        topic: d.topic,
        tags: d.tags,
        company: d.company,
        statement_md: d.statement_md,
        code_snippet: d.code_snippet,
        image_path: d.image_path,
        marks: d.marks,
        mcq_multi: d.mcq_multi,
        review_flags: d.review_flags,
        explanation_md: d.explanation_md,
        import_id: d.import_id ?? null,
        options: d.options,
      } as Json,
    });
    if (error) throw error;
    const r = data as unknown as { question_id: string; version_id: string };
    revalidatePath("/admin/questions");
    return { ok: true, questionId: r.question_id, versionId: r.version_id };
  } catch (e) {
    return toActionError(e);
  }
}

/** Publish the current draft of a coding problem. Extra TypeScript-level checks run before the SQL gate. */
export async function publishCodingQuestion(questionId: string): Promise<ActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const q = await supabase.from("questions").select("current_version_id").eq("id", questionId).single();
    if (q.error) throw q.error;
    const vid = q.data.current_version_id;
    if (!vid) return { ok: false, error: "Nothing to publish." };

    const [cfg, tests] = await Promise.all([
      supabase.from("coding_configs").select("execution_mode, function_signature, grading_mode").eq("question_version_id", vid).maybeSingle(),
      supabase.from("test_cases").select("input, visibility").eq("question_version_id", vid),
    ]);
    if (cfg.data?.execution_mode === "function" && cfg.data.grading_mode === "auto") {
      try {
        const sig = parseSignature(cfg.data.function_signature ?? "");
        for (const [i, t] of (tests.data ?? []).entries()) {
          const problem = checkTestInputShape(sig, t.input);
          if (problem) return { ok: false, error: `Test ${i + 1} (${t.visibility}) does not match the method signature: ${problem}` };
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    const { error } = await supabase.rpc("publish_coding_question", { p_question_id: questionId });
    if (error) throw error;
    revalidatePath("/admin/questions");
    revalidatePath(`/admin/questions/${questionId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export interface ValidationReport {
  /** Reports for the optional languages (C++ / C); the top-level fields are the Java run. */
  byLanguage?: Partial<Record<"cpp" | "c", Omit<ValidationReport, "byLanguage">>>;
  verdict: string;
  passed: number;
  total: number;
  compileOutput: string | null;
  tests: { id: string; visibility: string; status: string; expected: string; actual: string | null; message?: string }[];
  ranAt: string;
}

/** Run the stored reference solution against every configured test (public + hidden). */
export async function validateWithReference(versionId: string, language: Lang = "java"): Promise<ActionResult<{ report: ValidationReport }>> {
  try {
    await assertAdmin();
    const ctx = await loadEvalContext(versionId, language);
    if (!ctx) return { ok: false, error: "Configuration not found. Save the problem first." };
    if (!ctx.referenceSolution?.trim()) return { ok: false, error: "Add a reference solution first." };
    if (ctx.tests.length === 0) return { ok: false, error: "Add test cases first." };

    const out = await evaluate({ config: ctx.config, tests: ctx.tests, studentCode: ctx.referenceSolution, runner: getRunner() });
    if (out.systemError) return { ok: false, error: `The code runner is unavailable: ${out.systemError}` };
    const run: Omit<ValidationReport, "byLanguage"> = {
      verdict: out.summary.verdict,
      passed: out.full.filter((t) => t.status === "passed").length,
      total: out.full.length,
      compileOutput: out.compileOutput,
      tests: out.full.map((t) => ({ id: t.testId, visibility: t.visibility, status: t.status, expected: t.expected, actual: t.actual, message: t.message ?? (t.stderr || undefined) })),
      ranAt: new Date().toISOString(),
    };
    const supabase = await createClient();
    // Keep the other languages' reports: the Java run is the top level, the rest live under byLanguage.
    const prev = ((await supabase.from("coding_secrets").select("last_validation").eq("question_version_id", versionId).maybeSingle()).data?.last_validation ?? null) as ValidationReport | null;
    const report: ValidationReport = language === "java"
      ? { ...run, byLanguage: prev?.byLanguage }
      : { ...(prev ?? { verdict: "", passed: 0, total: 0, compileOutput: null, tests: [], ranAt: run.ranAt }), byLanguage: { ...(prev?.byLanguage ?? {}), [language]: run } };
    await supabase.from("coding_secrets").update({ last_validation: report as unknown as NonNullable<Json> }).eq("question_version_id", versionId);
    return { ok: true, report: language === "java" ? report : { ...run, byLanguage: report.byLanguage } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function unpublishQuestion(questionId: string, archive: boolean): Promise<ActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const { error } = await supabase.rpc("unpublish_question", { p_question_id: questionId, p_archive: archive });
    if (error) throw error;
    revalidatePath("/admin/questions");
    revalidatePath(`/admin/questions/${questionId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function restoreQuestion(questionId: string): Promise<ActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const { error } = await supabase.from("questions").update({ status: "draft" }).eq("id", questionId).eq("status", "archived");
    if (error) throw error;
    revalidatePath("/admin/questions");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

/** Permanently delete a question. Refused when students have work on it or a quiz uses it (archive instead). */
export async function deleteQuestion(questionId: string): Promise<ActionResult> {
  try {
    await assertAdmin();
    const db = createAdminClient();
    const versions = await db.from("question_versions").select("id").eq("question_id", questionId);
    const ids = (versions.data ?? []).map((v) => v.id);
    if (ids.length > 0) {
      const [subs, runs, quizzes] = await Promise.all([
        db.from("code_submissions").select("id", { count: "exact", head: true }).in("question_version_id", ids),
        db.from("code_runs").select("id", { count: "exact", head: true }).in("question_version_id", ids),
        db.from("assessment_questions").select("assessment_id", { count: "exact", head: true }).in("question_version_id", ids),
      ]);
      if ((subs.count ?? 0) + (runs.count ?? 0) > 0) {
        return { ok: false, error: "Students have submitted work on this question. Archive it instead to keep their history." };
      }
      if ((quizzes.count ?? 0) > 0) return { ok: false, error: "This question is used in a quiz. Remove it from the quiz or archive it instead." };
    }
    await db.from("questions").update({ current_version_id: null, published_version_id: null }).eq("id", questionId);
    const { error } = await db.from("questions").delete().eq("id", questionId);
    if (error) throw error;
    revalidatePath("/admin/questions");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export async function uploadQuestionImage(formData: FormData): Promise<ActionResult<{ path: string }>> {
  try {
    await assertAdmin();
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No file provided." };
    const ext = IMAGE_TYPES[file.type];
    if (!ext) return { ok: false, error: "Only PNG, JPEG, WebP or GIF images are allowed." };
    if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Image is larger than 5 MB." };
    const path = `${randomUUID()}.${ext}`;
    const supabase = await createClient();
    const { error } = await supabase.storage.from("question-assets").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return { ok: true, path };
  } catch (e) {
    return toActionError(e);
  }
}
