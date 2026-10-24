import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { processSubmission, requeueSystemError } from "@/lib/coding/submission";
import { jsonError, studentOr401 } from "@/lib/coding/student-api";
import { isExternalRunnerMode } from "@/lib/runner/mode";

export const maxDuration = 120;

const COLUMNS =
  "id, question_version_id, status, verdict, score_pct, marks_awarded, max_marks, passed_public, total_public, passed_hidden, total_hidden, exec_time_ms, memory_kb, compile_output, results, error_message, submitted_at, completed_at, claimed_at";

/** Poll a submission. Reads through RLS (own rows only). Recovers stalled jobs. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await studentOr401();
  if (user instanceof NextResponse) return user;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("Not found.", 404);

  const supabase = await createClient();
  const { data, error } = await supabase.from("code_submissions").select(COLUMNS).eq("id", id).eq("student_id", user.id).maybeSingle();
  if (error || !data) return jsonError("Not found.", 404);

  const age = Date.now() - new Date(data.submitted_at).getTime();
  const claimedAge = data.claimed_at ? Date.now() - new Date(data.claimed_at).getTime() : Infinity;
  if (!isExternalRunnerMode() && ((data.status === "queued" && age > 6_000) || (data.status === "running" && claimedAge > 95_000))) {
    after(() => processSubmission(id));
  }
  return NextResponse.json({ submission: data });
}

/** Retry a submission whose evaluation failed because the runner was unavailable. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await studentOr401();
  if (user instanceof NextResponse) return user;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("Not found.", 404);
  if (isExternalRunnerMode()) return jsonError("Evaluation is done by your instructor on this site.", 409);
  const ok = await requeueSystemError(id, user.id);
  if (!ok) return jsonError("This submission cannot be re-evaluated.", 409);
  after(() => processSubmission(id));
  return NextResponse.json({ ok: true, status: "queued" }, { status: 202 });
}
