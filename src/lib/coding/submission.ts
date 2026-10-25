import { isLang } from "./languages";
import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRunner } from "@/lib/runner";
import { loadEvalContext } from "./context";
import { evaluate } from "./evaluate";
import { round2, VERDICT_LABEL, type Verdict } from "./score";
import type { Database, Json } from "@/lib/supabase/database.types";

export const STALE_MS = 90_000;
const MAX_ATTEMPTS = 5;

/**
 * Grade a queued submission. Safe to call from several places (initial kick-off, poll
 * recovery, retry): an atomic claim guarantees a single worker processes it, and a
 * stale/crashed claim is recovered. A failed runner request can only ever produce a
 * `system_error` verdict — never Accepted.
 */
export interface ProcessOptions {
  /** Tell the student their submission was graded (used by the offline grader, where nobody is watching). */
  notifyStudent?: boolean;
  /** Default true. The offline grader turns it off: the admin was already told when it was submitted. */
  notifyAdmin?: boolean;
}

export async function processSubmission(submissionId: string, opts: ProcessOptions = {}): Promise<void> {
  const { notifyStudent = false, notifyAdmin = true } = opts;
  const db = createAdminClient();
  const token = randomUUID();
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();

  const claim = await db
    .from("code_submissions")
    .update({ status: "running", claimed_at: new Date().toISOString(), claim_token: token })
    .eq("id", submissionId)
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .select("id, student_id, question_version_id, source_code, language, attempts_count")
    .maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return;
  const sub = claim.data;
  const counter = await db.from("code_submissions").update({ attempts_count: sub.attempts_count + 1 }).eq("id", sub.id).eq("claim_token", token);
  if (counter.error) throw counter.error;
  const heartbeat = setInterval(() => {
    void db.from("code_submissions").update({ claimed_at: new Date().toISOString() })
      .eq("id", sub.id).eq("claim_token", token).eq("status", "running")
      .then(({ error }) => { if (error) console.error("[submission heartbeat]", sub.id, error); });
  }, 15_000);
  heartbeat.unref();
  const finish = async (patch: Database["public"]["Tables"]["code_submissions"]["Update"]) => {
    const saved = await db.from("code_submissions").update(patch).eq("id", sub.id)
      .eq("claim_token", token).eq("status", "running").select("id").maybeSingle();
    if (saved.error) throw saved.error;
    return !!saved.data; // a superseded worker must not write details or send notifications
  };

  try {
    const ctx = await loadEvalContext(sub.question_version_id, isLang(sub.language) ? sub.language : "java");
    if (!ctx) throw new Error("Problem configuration missing");

    if (ctx.gradingMode === "manual" || ctx.tests.length === 0) {
      const saved = await finish({
        status: "completed", verdict: "manual", score_pct: null, marks_awarded: null, max_marks: ctx.marks,
        passed_public: 0, total_public: 0, passed_hidden: 0, total_hidden: 0, completed_at: new Date().toISOString(),
      });
      if (!saved) return;
      if (notifyAdmin) await notifyAdmins(sub.id, ctx.title, "Awaiting manual review");
      return;
    }

    const out = await evaluate({ config: ctx.config, tests: ctx.tests, studentCode: sub.source_code, runner: getRunner() });
    const s = out.summary;

    if (out.systemError) {
      const saved = await finish({
        status: "system_error", verdict: "system_error", score_pct: null, max_marks: ctx.marks,
        results: out.student.map((r) => ({ ...r, message: "Execution service unavailable — your code was not evaluated." })) as unknown as NonNullable<Json>,
        error_message: "The execution service was unavailable. Your code was not evaluated — please try again.",
        completed_at: new Date().toISOString(),
      });
      if (!saved) return;
      await db.from("code_submission_private").upsert({ submission_id: sub.id, detailed_results: { systemError: out.systemError } as NonNullable<Json> });
      return;
    }

    const saved = await finish({
      status: "completed",
      verdict: s.verdict,
      score_pct: s.scorePct,
      marks_awarded: round2((ctx.marks * s.scorePct) / 100),
      max_marks: ctx.marks,
      passed_public: s.passedPublic, total_public: s.totalPublic,
      passed_hidden: s.passedHidden, total_hidden: s.totalHidden,
      exec_time_ms: out.execTimeMs, memory_kb: out.memoryKb,
      compile_output: out.compileOutput,
      results: out.student as unknown as NonNullable<Json>,
      error_message: null,
      completed_at: new Date().toISOString(),
    });
    if (!saved) return;
    await db.from("code_submission_private").upsert({ submission_id: sub.id, detailed_results: out.full as unknown as NonNullable<Json> });
    if (notifyAdmin) await notifyAdmins(sub.id, ctx.title, `${VERDICT_LABEL[s.verdict as Verdict]} · ${s.scorePct}%`);
    if (notifyStudent) {
      await db.from("notifications").insert({
        recipient_id: sub.student_id,
        type: "submission_graded",
        title: `Graded: ${ctx.title}`,
        body: `${VERDICT_LABEL[s.verdict as Verdict]} · ${s.scorePct}%`,
        link: `/student/submissions/${sub.id}`,
        reference_id: sub.id,
      });
    }
  } catch (e) {
    console.error("[processSubmission]", sub.id, e);
    const giveUp = sub.attempts_count + 1 >= MAX_ATTEMPTS;
    await db.from("code_submissions").update(
      giveUp
        ? { status: "system_error", verdict: "system_error", error_message: "Evaluation failed unexpectedly. Please resubmit.", completed_at: new Date().toISOString() }
        : { status: "queued", claimed_at: null },
    ).eq("id", sub.id).eq("claim_token", token).eq("status", "running");
  } finally {
    clearInterval(heartbeat);
  }
}

export async function notifyAdmins(submissionId: string, title: string, body: string) {
  const db = createAdminClient();
  const admins = await db.from("profiles").select("id").eq("role", "admin");
  if (!admins.data?.length) return;
  await db.from("notifications").insert(
    admins.data.map((a) => ({
      recipient_id: a.id,
      type: "code_submitted",
      title: `Submission: ${title}`,
      body,
      link: `/admin/submissions/code/${submissionId}`,
      reference_id: submissionId,
    })),
  );
}

/** Put a system_error submission back in the queue (same immutable code). */
export async function requeueSystemError(submissionId: string, studentId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db
    .from("code_submissions")
    .update({ status: "queued", verdict: null, error_message: null, claimed_at: null, claim_token: null, completed_at: null })
    .eq("id", submissionId)
    .eq("student_id", studentId)
    .eq("status", "system_error")
    .lt("attempts_count", MAX_ATTEMPTS + 5)
    .select("id");
  return (data?.length ?? 0) > 0;
}
