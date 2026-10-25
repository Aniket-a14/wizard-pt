import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { LanguageNotEnabledError, loadEvalContext } from "@/lib/coding/context";
import { LANGUAGES } from "@/lib/coding/languages";
import { CodeValidationError, validateStudentCode } from "@/lib/coding/compose";
import { notifyAdmins, processSubmission } from "@/lib/coding/submission";
import { isExternalRunnerMode } from "@/lib/runner/mode";
import { jsonError, studentCanSeeVersion, studentOr401 } from "@/lib/coding/student-api";

export const maxDuration = 120;

const body = z.object({
  versionId: z.string().uuid(),
  code: z.string().max(70_000),
  idempotencyKey: z.string().min(8).max(100),
  language: z.enum(LANGUAGES).default("java"),
});


export async function POST(req: NextRequest) {
  const user = await studentOr401();
  if (user instanceof NextResponse) return user;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400);
  const { versionId, code, idempotencyKey, language } = parsed.data;

  if (!(await studentCanSeeVersion(versionId))) return jsonError("Problem not found.", 404);
  const db = createAdminClient();

  let ctx;
  try {
    ctx = await loadEvalContext(versionId, language);
  } catch (e) {
    if (e instanceof LanguageNotEnabledError) return jsonError(e.message, 400);
    throw e;
  }
  if (!ctx) return jsonError("Problem not found.", 404);
  try {
    validateStudentCode(code, ctx.config);
  } catch (e) {
    if (e instanceof CodeValidationError) return jsonError(e.message, 400);
    throw e;
  }

  const ins = await db.rpc("enqueue_code_submission", {
    p_student_id: user.id, p_version_id: versionId, p_code: code, p_key: idempotencyKey,
    p_language: language, p_max_marks: ctx.marks,
  });
  if (ins.error) {
    if (ins.error.message === "Submission rate limit exceeded.") return jsonError("You've submitted a lot in a short time. Please wait a few minutes.", 429);
    if (ins.error.message === "Idempotency key belongs to a different submission.") return jsonError(ins.error.message, 409);
    console.error("[submit]", ins.error);
    return jsonError("Could not save your submission. Please try again.", 500);
  }
  const submission = ins.data as { id: string; status: string; duplicate: boolean };
  if (submission.duplicate) return NextResponse.json({ submissionId: submission.id, status: submission.status, duplicate: true, external: isExternalRunnerMode() });

  if (isExternalRunnerMode()) {
    // Nothing executes on this site: the submission waits (queued) for the admin's offline grader or manual review.
    after(() => notifyAdmins(submission.id, ctx.title, "Awaiting evaluation"));
    return NextResponse.json({ submissionId: submission.id, status: "queued", external: true }, { status: 202 });
  }
  after(() => processSubmission(submission.id));
  return NextResponse.json({ submissionId: submission.id, status: "queued" }, { status: 202 });
}
