import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { gradeMcq, seededShuffle, totalise } from "@/lib/mcq/grade";
import { parseQuizSettings, type QuizSettings } from "@/lib/mcq/settings";
import type { Json } from "@/lib/supabase/database.types";
import { canSeeAnswers, canSeeScore } from "@/lib/mcq/visibility";

/*
 * Quiz attempts are handled here with the service role, but EVERY function takes the
 * authenticated student's id and scopes by it. Answer keys never leave this module except
 * through `getAttemptResult`, which applies the quiz's release rules.
 */

const GRACE_MS = 8_000; // network slack when the timer runs out

export class QuizError extends Error {}

export interface QuizQuestionView {
  versionId: string;
  statement_md: string;
  code_snippet: string | null;
  imageUrl: string | null;
  multi: boolean;
  marks: number;
  options: { id: string; text: string }[];
}

export interface AttemptSession {
  attemptId: string;
  assessmentId: string;
  title: string;
  description: string | null;
  deadlineAt: string | null;
  serverNow: string;
  settings: QuizSettings;
  questions: QuizQuestionView[];
  answers: Record<string, { selected: string[]; marked: boolean }>;
}

async function ownedAttempt(attemptId: string, studentId: string) {
  const db = createAdminClient();
  const { data, error } = await db.from("assessment_attempts").select("*").eq("id", attemptId).eq("student_id", studentId).maybeSingle();
  if (error) throw error;
  if (!data) throw new QuizError("Attempt not found.");
  return data;
}

export async function startOrResumeAttempt(assessmentId: string, studentId: string): Promise<string> {
  const db = createAdminClient();
  const a = await db.from("assessments").select("id, status, settings").eq("id", assessmentId).maybeSingle();
  if (!a.data || a.data.status !== "published") throw new QuizError("This quiz is not available.");
  const settings = parseQuizSettings(a.data.settings);

  const open = await db.from("assessment_attempts").select("id, deadline_at").eq("assessment_id", assessmentId).eq("student_id", studentId).eq("status", "in_progress").maybeSingle();
  if (open.data) {
    if (open.data.deadline_at && Date.now() > new Date(open.data.deadline_at).getTime() + GRACE_MS) {
      await finalizeAttempt(open.data.id, studentId, true);
    } else {
      return open.data.id;
    }
  }

  const prev = await db.from("assessment_attempts").select("attempt_no").eq("assessment_id", assessmentId).eq("student_id", studentId).order("attempt_no", { ascending: false });
  const used = prev.data?.length ?? 0;
  if (used >= settings.max_attempts) throw new QuizError(`You have used all ${settings.max_attempts} attempt${settings.max_attempts === 1 ? "" : "s"}.`);

  const qs = await db.from("assessment_questions").select("question_version_id, ordering").eq("assessment_id", assessmentId).order("ordering");
  let order = (qs.data ?? []).map((q) => q.question_version_id);
  const id = randomUUID();
  if (settings.shuffle_questions) order = seededShuffle(order, id);
  const startedAt = new Date();
  const ins = await db.from("assessment_attempts").insert({
    id,
    assessment_id: assessmentId,
    student_id: studentId,
    attempt_no: (prev.data?.[0]?.attempt_no ?? 0) + 1,
    started_at: startedAt.toISOString(),
    deadline_at: settings.timer_minutes ? new Date(startedAt.getTime() + settings.timer_minutes * 60_000).toISOString() : null,
    question_order: order,
  });
  if (ins.error) {
    // Unique index "one open attempt": a parallel request won — return that one.
    const again = await db.from("assessment_attempts").select("id").eq("assessment_id", assessmentId).eq("student_id", studentId).eq("status", "in_progress").maybeSingle();
    if (again.data) return again.data.id;
    throw ins.error;
  }
  return id;
}

export async function loadAttemptSession(attemptId: string, studentId: string): Promise<AttemptSession> {
  const db = createAdminClient();
  let attempt = await ownedAttempt(attemptId, studentId);
  if (attempt.status !== "in_progress") throw new QuizError("This attempt has already been submitted.");
  if (attempt.deadline_at && Date.now() > new Date(attempt.deadline_at).getTime() + GRACE_MS) {
    await finalizeAttempt(attemptId, studentId, true);
    throw new QuizError("Time is up — your attempt was submitted automatically.");
  }
  attempt = (await ownedAttempt(attemptId, studentId));

  const [assessment, aqs, answers] = await Promise.all([
    db.from("assessments").select("id, title, description, settings").eq("id", attempt.assessment_id).single(),
    db.from("assessment_questions").select("question_version_id, marks").eq("assessment_id", attempt.assessment_id),
    db.from("attempt_answers").select("question_version_id, selected_option_ids, marked_for_review").eq("attempt_id", attemptId),
  ]);
  if (assessment.error) throw assessment.error;
  const settings = parseQuizSettings(assessment.data.settings);
  const marksBy = new Map((aqs.data ?? []).map((q) => [q.question_version_id, Number(q.marks)]));
  const ids = attempt.question_order.length ? attempt.question_order : [...marksBy.keys()];

  const [versions, options] = await Promise.all([
    db.from("question_versions").select("id, statement_md, code_snippet, image_path, mcq_multi").in("id", ids),
    db.from("mcq_options").select("id, question_version_id, option_text, display_order").in("question_version_id", ids).order("display_order"),
  ]);
  const vBy = new Map((versions.data ?? []).map((v) => [v.id, v]));
  const questions: QuizQuestionView[] = [];
  for (const id of ids) {
    const v = vBy.get(id);
    if (!v) continue;
    let opts = (options.data ?? []).filter((o) => o.question_version_id === id).map((o) => ({ id: o.id, text: o.option_text }));
    if (settings.shuffle_options) opts = seededShuffle(opts, `${attemptId}:${id}`);
    let imageUrl: string | null = null;
    if (v.image_path) {
      const s = await db.storage.from("question-assets").createSignedUrl(v.image_path, 3600);
      imageUrl = s.data?.signedUrl ?? null;
    }
    questions.push({ versionId: id, statement_md: v.statement_md, code_snippet: v.code_snippet, imageUrl, multi: v.mcq_multi, marks: marksBy.get(id) ?? 1, options: opts });
  }

  return {
    attemptId,
    assessmentId: attempt.assessment_id,
    title: assessment.data.title,
    description: assessment.data.description,
    deadlineAt: attempt.deadline_at,
    serverNow: new Date().toISOString(),
    settings,
    questions,
    answers: Object.fromEntries((answers.data ?? []).map((a) => [a.question_version_id, { selected: a.selected_option_ids, marked: a.marked_for_review }])),
  };
}

export async function saveAnswer(args: { attemptId: string; studentId: string; versionId: string; selected: string[]; marked: boolean }): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.rpc("save_quiz_answer", {
    p_attempt_id: args.attemptId, p_student_id: args.studentId, p_version_id: args.versionId,
    p_selected: args.selected, p_marked: args.marked,
  });
  if (error?.code === "P0001") throw new QuizError(error.message);
  if (error) throw error;
}

/** Grade and lock an attempt. Safe to call repeatedly/concurrently: only the first call changes anything. */
export async function finalizeAttempt(attemptId: string, studentId: string, auto = false): Promise<void> {
  const db = createAdminClient();
  for (let retry = 0; retry < 8; retry++) {
    const attempt = await ownedAttempt(attemptId, studentId);
    if (attempt.status === "submitted") return;
    const [assessment, aqs, answers] = await Promise.all([
      db.from("assessments").select("settings").eq("id", attempt.assessment_id).single(),
      db.from("assessment_questions").select("question_version_id, marks").eq("assessment_id", attempt.assessment_id),
      db.from("attempt_answers").select("question_version_id, selected_option_ids").eq("attempt_id", attemptId),
    ]);
    if (assessment.error) throw assessment.error;
    if (aqs.error) throw aqs.error;
    if (answers.error) throw answers.error;
    if (!aqs.data.length) throw new QuizError("This quiz has no questions to grade.");
    const settings = parseQuizSettings(assessment.data.settings);
    const ids = aqs.data.map((q) => q.question_version_id);
    const [keys, versions] = await Promise.all([
      db.from("mcq_correct_options").select("option_id, question_version_id").in("question_version_id", ids),
      db.from("question_versions").select("id, mcq_multi").in("id", ids),
    ]);
    if (keys.error) throw keys.error;
    if (versions.error) throw versions.error;
    if (versions.data.length !== ids.length || ids.some((id) => !keys.data.some((k) => k.question_version_id === id))) {
      throw new QuizError("Quiz grading data is incomplete.");
    }
    const multiBy = new Map(versions.data.map((v) => [v.id, v.mcq_multi]));
    const ansBy = new Map(answers.data.map((a) => [a.question_version_id, a.selected_option_ids]));
    const graded = aqs.data.map((q) => {
      const marks = Number(q.marks);
      const grade = gradeMcq({ selected: ansBy.get(q.question_version_id) ?? [],
        correct: keys.data.filter((k) => k.question_version_id === q.question_version_id).map((k) => k.option_id),
        marks, multi: multiBy.get(q.question_version_id)! }, settings);
      return { versionId: q.question_version_id, marks, grade };
    });
    const totals = totalise(graded);
    const committed = await db.rpc("commit_quiz_attempt", {
      p_attempt_id: attemptId, p_student_id: studentId, p_answers: Object.fromEntries(ansBy) as Json,
      p_grades: graded.map((g) => ({ question_version_id: g.versionId, is_correct: g.grade.isCorrect,
        awarded_marks: g.grade.awarded, max_marks: g.marks })) as Json,
      p_score: totals.score, p_max_score: totals.maxScore, p_auto: auto,
    });
    if (committed.error?.code === "P0001") throw new QuizError(committed.error.message);
    if (committed.error) throw committed.error;
    if (committed.data) return;
  }
  throw new QuizError("Answers changed while submitting. Please submit again.");
}

export interface AttemptResult {
  attemptId: string;
  assessmentId: string;
  title: string;
  attemptNo: number;
  submittedAt: string | null;
  autoSubmitted: boolean;
  score: { score: number; maxScore: number; correct: number; incorrect: number; unanswered: number } | null;
  scorePending: boolean;
  review: {
    versionId: string;
    statement_md: string;
    code_snippet: string | null;
    options: { id: string; text: string; selected: boolean; correct: boolean }[];
    awarded: number;
    maxMarks: number;
    isCorrect: boolean;
    explanation: string | null;
  }[] | null;
  answersPending: boolean;
  feedback: { status: string; marks: number | null; maxMarks: number | null; comments: string | null; suggestions: string | null; explanation: string | null; publishedAt: string | null } | null;
}

/** The student's view of a submitted attempt, with release rules applied server-side. */
export async function getAttemptResult(attemptId: string, studentId: string): Promise<AttemptResult> {
  const db = createAdminClient();
  const attempt = await ownedAttempt(attemptId, studentId);
  if (attempt.status !== "submitted") throw new QuizError("This attempt is still in progress.");
  const a = await db.from("assessments").select("title, settings, results_released_at, answers_released_at").eq("id", attempt.assessment_id).single();
  if (a.error) throw a.error;
  const settings = parseQuizSettings(a.data.settings);
  const showScore = canSeeScore(settings, a.data);
  const showAnswers = canSeeAnswers(settings, a.data);

  const grades = await db.from("attempt_grades").select("*").eq("attempt_id", attemptId);
  const totals = totalise((grades.data ?? []).map((g) => ({ marks: Number(g.max_marks), grade: { answered: true, isCorrect: g.is_correct, awarded: Number(g.awarded_marks) } })));
  // `totalise` can't tell unanswered from wrong; recompute from stored answers.
  const answers = await db.from("attempt_answers").select("question_version_id, selected_option_ids").eq("attempt_id", attemptId);
  const answered = new Set((answers.data ?? []).filter((x) => x.selected_option_ids.length > 0).map((x) => x.question_version_id));
  const unanswered = (grades.data ?? []).filter((g) => !answered.has(g.question_version_id)).length;
  const correct = (grades.data ?? []).filter((g) => g.is_correct).length;

  let review: AttemptResult["review"] = null;
  if (showAnswers) {
    const ids = attempt.question_order;
    const [versions, options, keys, secrets] = await Promise.all([
      db.from("question_versions").select("id, statement_md, code_snippet").in("id", ids),
      db.from("mcq_options").select("id, question_version_id, option_text, display_order").in("question_version_id", ids).order("display_order"),
      db.from("mcq_correct_options").select("option_id").in("question_version_id", ids),
      db.from("question_secrets").select("question_version_id, explanation_md").in("question_version_id", ids),
    ]);
    const correctSet = new Set((keys.data ?? []).map((k) => k.option_id));
    const ansBy = new Map((answers.data ?? []).map((x) => [x.question_version_id, new Set(x.selected_option_ids)]));
    const gBy = new Map((grades.data ?? []).map((g) => [g.question_version_id, g]));
    review = ids.flatMap((id) => {
      const v = (versions.data ?? []).find((x) => x.id === id);
      const g = gBy.get(id);
      if (!v || !g) return [];
      return [{
        versionId: id,
        statement_md: v.statement_md,
        code_snippet: v.code_snippet,
        options: (options.data ?? []).filter((o) => o.question_version_id === id).map((o) => ({ id: o.id, text: o.option_text, selected: ansBy.get(id)?.has(o.id) ?? false, correct: correctSet.has(o.id) })),
        awarded: Number(g.awarded_marks),
        maxMarks: Number(g.max_marks),
        isCorrect: g.is_correct,
        explanation: secrets.data?.find((s) => s.question_version_id === id)?.explanation_md ?? null,
      }];
    });
  }

  const fb = await db.from("reviews").select("status, marks, max_marks, comments, suggestions, explanation, published_at").eq("attempt_id", attemptId).not("published_at", "is", null).maybeSingle();

  return {
    attemptId,
    assessmentId: attempt.assessment_id,
    title: a.data.title,
    attemptNo: attempt.attempt_no,
    submittedAt: attempt.submitted_at,
    autoSubmitted: attempt.auto_submitted,
    score: showScore ? { score: Number(attempt.score ?? totals.score), maxScore: Number(attempt.max_score ?? totals.maxScore), correct, incorrect: (grades.data?.length ?? 0) - correct - unanswered, unanswered } : null,
    scorePending: !showScore,
    review,
    answersPending: !showAnswers && settings.show_answers !== "never",
    feedback: fb.data ? { status: fb.data.status, marks: fb.data.marks === null ? null : Number(fb.data.marks), maxMarks: fb.data.max_marks === null ? null : Number(fb.data.max_marks), comments: fb.data.comments, suggestions: fb.data.suggestions, explanation: fb.data.explanation, publishedAt: fb.data.published_at } : null,
  };
}
