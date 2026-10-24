import "server-only";
import { NextResponse } from "next/server";
import { AuthError, assertStudent, type SessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { RunnerUnavailableError } from "@/lib/runner/types";

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function studentOr401(): Promise<SessionUser | NextResponse> {
  try {
    return await assertStudent();
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, e.status);
    throw e;
  }
}

/** True when RLS lets this student see the version (published/theirs). Hidden content stays hidden. */
export async function studentCanSeeVersion(versionId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("question_versions").select("id").eq("id", versionId).maybeSingle();
  return !!data;
}

export function runnerErrorResponse(e: unknown) {
  if (e instanceof RunnerUnavailableError) return jsonError("The code execution service is not available right now. Nothing was graded — please try again shortly.", 503);
  console.error("[code api]", e);
  return jsonError("Something went wrong. Please try again.", 500);
}
