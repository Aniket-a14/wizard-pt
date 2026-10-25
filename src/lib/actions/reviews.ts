"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { toActionError, zodFieldErrors, type ActionResult } from "./common";

const schema = z.object({
  target: z.enum(["code", "quiz"]),
  id: z.string().uuid(),
  status: z.enum(["reviewed", "needs_improvement", "accepted", "rejected"]),
  marks: z.number().min(0).max(100_000).nullable(),
  maxMarks: z.number().min(0).max(100_000).nullable(),
  comments: z.string().max(10_000).default(""),
  suggestions: z.string().max(10_000).default(""),
  explanation: z.string().max(10_000).default(""),
  publish: z.boolean(),
});
export type ReviewInput = z.input<typeof schema>;

/**
 * Save the admin's manual review. Automated verdicts live on the submission itself; this is the
 * separate human decision. Students see it only after `publish`, which also notifies them.
 */
export async function saveReview(input: ReviewInput): Promise<ActionResult<{ publishedAt: string | null; hasDraft: boolean }>> {
  try {
    const admin = await assertAdmin();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, fieldErrors: zodFieldErrors(parsed.error.issues) };
    const d = parsed.data;
    const supabase = await createClient();
    const col = d.target === "code" ? "code_submission_id" : "attempt_id";

    const payload = {
      reviewer_id: admin.id, status: d.status, marks: d.marks, max_marks: d.maxMarks,
      comments: d.comments || null, suggestions: d.suggestions || null, explanation: d.explanation || null,
      [col]: d.id,
    };
    const saved = await supabase.rpc("save_review", { p_payload: payload as Json, p_publish: d.publish });
    if (saved.error) throw saved.error;
    const result = saved.data as { publishedAt: string | null; hasDraft: boolean };

    if (d.publish) {
      // Find the student and tell them (service role: students cannot be written to by the admin client's RLS).
      const db = createAdminClient();
      let studentId: string | null = null;
      let assessmentId: string | null = null;
      let title = "your submission";
      if (d.target === "code") {
        const s = await db.from("code_submissions").select("student_id, v:question_versions(title)").eq("id", d.id).single();
        studentId = s.data?.student_id ?? null;
        title = s.data?.v?.title ?? title;
      } else {
        const s = await db.from("assessment_attempts").select("student_id, assessment_id, a:assessments(title)").eq("id", d.id).single();
        studentId = s.data?.student_id ?? null;
        assessmentId = s.data?.assessment_id ?? null;
        title = s.data?.a?.title ?? title;
      }
      if (studentId) {
        await db.from("notifications").insert({
          recipient_id: studentId,
          type: "feedback_published",
          title: `Feedback on ${title}`,
          body: d.comments ? d.comments.slice(0, 140) : "Your instructor reviewed your work.",
          link: d.target === "code" ? `/student/submissions/${d.id}` : `/student/quizzes/${assessmentId}?attempt=${d.id}`,
          reference_id: d.id,
        });
      }
    }
    revalidatePath("/admin/submissions");
    return { ok: true, ...result };
  } catch (e) {
    return toActionError(e);
  }
}
