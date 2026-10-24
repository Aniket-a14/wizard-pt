"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { quizDraftSchema, type QuizDraftInput } from "@/lib/validation/question";
import { parseQuizSettings } from "@/lib/mcq/settings";
import { toActionError, zodFieldErrors, type ActionResult } from "./common";
import type { Json } from "@/lib/supabase/database.types";

export async function saveQuizDraft(input: QuizDraftInput): Promise<ActionResult<{ assessmentId: string }>> {
  try {
    await assertAdmin();
    const parsed = quizDraftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, fieldErrors: zodFieldErrors(parsed.error.issues) };
    const settings = parseQuizSettings(parsed.data.settings);
    const ids = parsed.data.questions.map((q) => q.question_id);
    if (new Set(ids).size !== ids.length) return { ok: false, error: "A question appears twice in the quiz." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_quiz_draft", {
      p_assessment_id: parsed.data.assessmentId ?? undefined,
      p_payload: { title: parsed.data.title, description: parsed.data.description, settings, questions: parsed.data.questions } as Json,
    });
    if (error) throw error;
    revalidatePath("/admin/quizzes");
    return { ok: true, assessmentId: data as string };
  } catch (e) {
    return toActionError(e);
  }
}

export async function publishQuiz(assessmentId: string): Promise<ActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const { error } = await supabase.rpc("publish_assessment", { p_assessment_id: assessmentId });
    if (error) throw error;
    revalidatePath("/admin/quizzes");
    revalidatePath(`/admin/quizzes/${assessmentId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function unpublishQuiz(assessmentId: string): Promise<ActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const { error } = await supabase.rpc("unpublish_assessment", { p_assessment_id: assessmentId });
    if (error) throw error;
    revalidatePath("/admin/quizzes");
    revalidatePath(`/admin/quizzes/${assessmentId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function archiveQuiz(assessmentId: string): Promise<ActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const { error } = await supabase.from("assessments").update({ status: "archived" }).eq("id", assessmentId);
    if (error) throw error;
    revalidatePath("/admin/quizzes");
    revalidatePath(`/admin/quizzes/${assessmentId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteQuizDraft(assessmentId: string): Promise<ActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const a = await supabase.from("assessments").select("status").eq("id", assessmentId).single();
    if (a.error) throw a.error;
    if (a.data.status !== "draft") return { ok: false, error: "Only draft quizzes can be deleted. Archive it instead." };
    const { error } = await supabase.from("assessments").delete().eq("id", assessmentId);
    if (error) throw error;
    revalidatePath("/admin/quizzes");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

/** Release scores and/or correct answers to students; notifies them. */
export async function releaseQuiz(assessmentId: string, what: "results" | "answers"): Promise<ActionResult> {
  try {
    await assertAdmin();
    const supabase = await createClient();
    const a = await supabase.from("assessments").select("title, status, results_released_at, answers_released_at").eq("id", assessmentId).single();
    if (a.error) throw a.error;
    if (a.data.status === "draft") return { ok: false, error: "Publish the quiz first." };
    const now = new Date().toISOString();
    const patch = what === "results" ? { results_released_at: a.data.results_released_at ?? now } : { answers_released_at: a.data.answers_released_at ?? now };
    const { error } = await supabase.from("assessments").update(patch).eq("id", assessmentId);
    if (error) throw error;

    // Only notify students who actually attempted the quiz.
    const db = createAdminClient();
    const attempts = await db.from("assessment_attempts").select("student_id").eq("assessment_id", assessmentId).eq("status", "submitted");
    const students = [...new Set((attempts.data ?? []).map((r) => r.student_id))];
    if (students.length > 0) {
      await db.from("notifications").insert(
        students.map((student_id) => ({
          recipient_id: student_id,
          type: what === "results" ? "result_released" : "answers_released",
          title: what === "results" ? `Results released: ${a.data.title}` : `Answers released: ${a.data.title}`,
          body: what === "results" ? "Your score is now available." : "You can now review the correct answers.",
          link: `/student/quizzes/${assessmentId}`,
          reference_id: assessmentId,
        })),
      );
    }
    revalidatePath(`/admin/quizzes/${assessmentId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
