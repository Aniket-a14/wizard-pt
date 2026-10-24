import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadEvalContext } from "@/lib/coding/context";
import { CodeValidationError, validateStudentCode } from "@/lib/coding/compose";
import { notifyAdmins, processSubmission } from "@/lib/coding/submission";
import { isExternalRunnerMode } from "@/lib/runner/mode";
import { jsonError, studentCanSeeVersion, studentOr401 } from "@/lib/coding/student-api";

export const maxDuration = 120;

const body = z.object({
  versionId: z.string().uuid(),
  code: z.string().max(70_000),
  idempotencyKey: z.string().min(8).max(100),
});

const SUBMITS_PER_10_MIN = 12;

export async function POST(req: NextRequest) {
  const user = await studentOr401();
  if (user instanceof NextResponse) return user;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400);
  const { versionId, code, idempotencyKey } = parsed.data;

  if (!(await studentCanSeeVersion(versionId))) return jsonError("Problem not found.", 404);
  const db = createAdminClient();

  // Retry-safe: the same key always maps to the same immutable submission (double clicks, flaky networks).
  const existing = await db.from("code_submissions").select("id, status").eq("student_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing.data) return NextResponse.json({ submissionId: existing.data.id, status: existing.data.status, duplicate: true });

  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const recent = await db.from("code_submissions").select("id", { count: "exact", head: true }).eq("student_id", user.id).gte("submitted_at", since);
  if ((recent.count ?? 0) >= SUBMITS_PER_10_MIN) return jsonError("You've submitted a lot in a short time. Please wait a few minutes.", 429);

  const ctx = await loadEvalContext(versionId);
  if (!ctx) return jsonError("Problem not found.", 404);
  try {
    validateStudentCode(code, ctx.config);
  } catch (e) {
    if (e instanceof CodeValidationError) return jsonError(e.message, 400);
    throw e;
  }

  const ins = await db
    .from("code_submissions")
    .insert({ student_id: user.id, question_version_id: versionId, source_code: code, idempotency_key: idempotencyKey, language: "java", status: "queued", max_marks: ctx.marks })
    .select("id, status")
    .single();
  if (ins.error) {
    // Lost a race with a parallel identical request.
    const again = await db.from("code_submissions").select("id, status").eq("student_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (again.data) return NextResponse.json({ submissionId: again.data.id, status: again.data.status, duplicate: true });
    console.error("[submit]", ins.error);
    return jsonError("Could not save your submission. Please try again.", 500);
  }

  if (isExternalRunnerMode()) {
    // Nothing executes on this site: the submission waits (queued) for the admin's offline grader or manual review.
    after(() => notifyAdmins(ins.data.id, ctx.title, "Awaiting evaluation"));
    return NextResponse.json({ submissionId: ins.data.id, status: "queued", external: true }, { status: 202 });
  }
  after(() => processSubmission(ins.data.id));
  return NextResponse.json({ submissionId: ins.data.id, status: "queued" }, { status: 202 });
}
