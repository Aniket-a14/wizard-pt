import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseQuizSettings } from "@/lib/mcq/settings";
import { canSeeAnswers, canSeeScore } from "@/lib/mcq/visibility";

export interface Progress {
  problemsPublished: number;
  problemsAttempted: number;
  problemsSolved: number;
  submissionsTotal: number;
  acceptedSubmissions: number;
  acceptanceRate: number | null;
  mcqAnswered: number;
  mcqCorrect: number;
  mcqAccuracy: number | null;
  quizzesSubmitted: number;
  avgQuizPct: number | null;
  byTopic: { topic: string; attempted: number; solved: number; mcqCorrect: number; mcqTotal: number }[];
  byDifficulty: { level: string; published: number; solved: number }[];
  recent: { kind: "code" | "quiz"; title: string; detail: string; at: string; href: string }[];
  feedbackCount: number;
}

/**
 * Real aggregates for the signed-in student. Anything that would reveal quiz answers or scores
 * before release is excluded using the same visibility rules as the result pages.
 */
export async function getProgress(studentId: string): Promise<Progress> {
  const supabase = await createClient();
  const db = createAdminClient();

  const [published, subs, attempts, reviews] = await Promise.all([
    supabase.from("questions").select("id, pub:question_versions!questions_published_version_fk(difficulty, topic)").eq("type", "coding").eq("status", "published"),
    supabase.from("code_submissions").select("id, verdict, status, submitted_at, v:question_versions(question_id, title, topic, difficulty)").eq("student_id", studentId).order("submitted_at", { ascending: false }),
    db.from("assessment_attempts").select("id, assessment_id, status, score, max_score, submitted_at, a:assessments(title, settings, results_released_at, answers_released_at)").eq("student_id", studentId).eq("status", "submitted").order("submitted_at", { ascending: false }),
    supabase.from("reviews").select("id").not("published_at", "is", null),
  ]);

  const solvedQ = new Set<string>();
  const attemptedQ = new Set<string>();
  const topics = new Map<string, { topic: string; attempted: Set<string>; solved: Set<string>; mcqCorrect: number; mcqTotal: number }>();
  const topicOf = (t: string | null | undefined) => (t && t.trim()) || "General";
  const topicRow = (t: string) => topics.get(t) ?? topics.set(t, { topic: t, attempted: new Set(), solved: new Set(), mcqCorrect: 0, mcqTotal: 0 }).get(t)!;

  const done = (subs.data ?? []).filter((s) => s.status === "completed");
  for (const s of subs.data ?? []) {
    const qid = s.v?.question_id;
    if (!qid) continue;
    attemptedQ.add(qid);
    topicRow(topicOf(s.v?.topic)).attempted.add(qid);
    if (s.verdict === "accepted") {
      solvedQ.add(qid);
      topicRow(topicOf(s.v?.topic)).solved.add(qid);
    }
  }

  const diff = new Map<string, { level: string; published: number; solved: number }>();
  for (const q of published.data ?? []) {
    const level = q.pub?.difficulty ?? "easy";
    const row = diff.get(level) ?? diff.set(level, { level, published: 0, solved: 0 }).get(level)!;
    row.published++;
    if (solvedQ.has(q.id)) row.solved++;
  }

  // Quiz data respecting release rules.
  let mcqAnswered = 0, mcqCorrect = 0;
  const pcts: number[] = [];
  const answerVisible = (attempts.data ?? []).filter((t) => t.a && canSeeAnswers(parseQuizSettings(t.a.settings), t.a));
  if (answerVisible.length > 0) {
    const ids = answerVisible.map((t) => t.id);
    const grades = await db.from("attempt_grades").select("attempt_id, question_version_id, is_correct, v:question_versions(topic)").in("attempt_id", ids);
    const ans = await db.from("attempt_answers").select("attempt_id, question_version_id, selected_option_ids").in("attempt_id", ids);
    const answeredSet = new Set((ans.data ?? []).filter((a) => a.selected_option_ids.length > 0).map((a) => `${a.attempt_id}:${a.question_version_id}`));
    for (const g of grades.data ?? []) {
      if (!answeredSet.has(`${g.attempt_id}:${g.question_version_id}`)) continue;
      mcqAnswered++;
      const row = topicRow(topicOf(g.v?.topic));
      row.mcqTotal++;
      if (g.is_correct) { mcqCorrect++; row.mcqCorrect++; }
    }
  }
  for (const t of attempts.data ?? []) {
    if (t.a && canSeeScore(parseQuizSettings(t.a.settings), t.a) && t.max_score && Number(t.max_score) > 0) pcts.push((Number(t.score) / Number(t.max_score)) * 100);
  }

  const recent = [
    ...(subs.data ?? []).slice(0, 8).map((s) => ({ kind: "code" as const, title: s.v?.title ?? "Problem", detail: s.status === "completed" ? (s.verdict ?? "").replace(/_/g, " ") : "evaluating", at: s.submitted_at, href: `/student/submissions/${s.id}` })),
    ...(attempts.data ?? []).slice(0, 8).map((t) => ({ kind: "quiz" as const, title: t.a?.title ?? "Quiz", detail: "submitted", at: t.submitted_at ?? "", href: `/student/quizzes/${t.assessment_id}?attempt=${t.id}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  return {
    problemsPublished: published.data?.length ?? 0,
    problemsAttempted: attemptedQ.size,
    problemsSolved: solvedQ.size,
    submissionsTotal: done.length,
    acceptedSubmissions: done.filter((s) => s.verdict === "accepted").length,
    acceptanceRate: done.length ? (done.filter((s) => s.verdict === "accepted").length / done.length) * 100 : null,
    mcqAnswered, mcqCorrect,
    mcqAccuracy: mcqAnswered ? (mcqCorrect / mcqAnswered) * 100 : null,
    quizzesSubmitted: attempts.data?.length ?? 0,
    avgQuizPct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
    byTopic: [...topics.values()].map((t) => ({ topic: t.topic, attempted: t.attempted.size, solved: t.solved.size, mcqCorrect: t.mcqCorrect, mcqTotal: t.mcqTotal })).sort((a, b) => a.topic.localeCompare(b.topic)),
    byDifficulty: ["easy", "medium", "hard"].map((l) => diff.get(l) ?? { level: l, published: 0, solved: 0 }),
    recent,
    feedbackCount: reviews.data?.length ?? 0,
  };
}
