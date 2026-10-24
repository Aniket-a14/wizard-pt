"use server";

import { revalidatePath } from "next/cache";
import { assertStudent } from "@/lib/auth/session";
import { QuizError, finalizeAttempt, saveAnswer as saveAnswerImpl, startOrResumeAttempt } from "@/lib/quiz/server";
import { toActionError, type ActionResult } from "./common";

function map(e: unknown) {
  return e instanceof QuizError ? { ok: false as const, error: e.message } : toActionError(e);
}

export async function startQuizAttempt(assessmentId: string): Promise<ActionResult<{ attemptId: string }>> {
  try {
    const u = await assertStudent();
    const attemptId = await startOrResumeAttempt(assessmentId, u.id);
    return { ok: true, attemptId };
  } catch (e) {
    return map(e);
  }
}

export async function saveQuizAnswer(args: { attemptId: string; versionId: string; selected: string[]; marked: boolean }): Promise<ActionResult> {
  try {
    const u = await assertStudent();
    await saveAnswerImpl({ ...args, studentId: u.id });
    return { ok: true };
  } catch (e) {
    return map(e);
  }
}

export async function submitQuizAttempt(attemptId: string): Promise<ActionResult> {
  try {
    const u = await assertStudent();
    await finalizeAttempt(attemptId, u.id, false);
    revalidatePath("/student", "layout");
    return { ok: true };
  } catch (e) {
    return map(e);
  }
}
