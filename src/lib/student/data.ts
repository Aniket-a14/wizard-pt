import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseQuizSettings } from "@/lib/mcq/settings";

export interface ProblemRow {
  questionId: string;
  seq: number;
  versionId: string;
  title: string;
  difficulty: string;
  topic: string | null;
  tags: string[];
  company: string | null;
  marks: number;
  estMinutes: number | null;
  /** best outcome so far */
  state: "new" | "attempted" | "accepted";
  bestScore: number | null;
  submissions: number;
  lastSubmittedAt: string | null;
  /** true when the admin has published feedback on one of her submissions */
  hasFeedback: boolean;
}

/** Published coding problems visible to the signed-in student, with her own progress (all via RLS). */
export async function listProblems(studentId: string): Promise<ProblemRow[]> {
  const supabase = await createClient();
  const [qs, subs, reviews] = await Promise.all([
    supabase
      .from("questions")
      .select("id, seq, published_version_id, pub:question_versions!questions_published_version_fk(id, title, difficulty, topic, tags, company, marks, est_minutes)")
      .eq("type", "coding")
      .eq("status", "published"),
    supabase.from("code_submissions").select("id, verdict, score_pct, submitted_at, status, v:question_versions(question_id)").eq("student_id", studentId).order("submitted_at", { ascending: false }),
    supabase.from("reviews").select("code_submission_id").not("published_at", "is", null),
  ]);
  const reviewed = new Set((reviews.data ?? []).map((r) => r.code_submission_id));
  const bySub = new Map<string, NonNullable<typeof subs.data>>();
  for (const s of subs.data ?? []) {
    const qid = s.v?.question_id;
    if (!qid) continue;
    bySub.set(qid, [...(bySub.get(qid) ?? []), s]);
  }
  return (qs.data ?? [])
    .filter((q) => q.pub)
    .map((q) => {
      const mine = bySub.get(q.id) ?? [];
      const best = mine.reduce<number | null>((m, s) => (s.score_pct === null ? m : Math.max(m ?? 0, Number(s.score_pct))), null);
      return {
        questionId: q.id,
        seq: q.seq,
        versionId: q.pub!.id,
        title: q.pub!.title,
        difficulty: q.pub!.difficulty,
        topic: q.pub!.topic,
        tags: q.pub!.tags,
        company: q.pub!.company,
        marks: Number(q.pub!.marks),
        estMinutes: q.pub!.est_minutes,
        state: (mine.some((s) => s.verdict === "accepted") ? "accepted" : mine.length > 0 ? "attempted" : "new") as ProblemRow["state"],
        bestScore: best,
        submissions: mine.length,
        lastSubmittedAt: mine[0]?.submitted_at ?? null,
        hasFeedback: mine.some((s) => reviewed.has(s.id)),
      };
    })
    .sort((a, b) => a.seq - b.seq);
}

export interface QuizRow {
  id: string;
  seq: number;
  title: string;
  description: string | null;
  questionCount: number;
  totalMarks: number;
  timerMinutes: number | null;
  maxAttempts: number;
  attemptsUsed: number;
  openAttemptId: string | null;
  lastSubmittedAttemptId: string | null;
  status: string;
}

export async function listQuizzes(studentId: string): Promise<QuizRow[]> {
  const supabase = await createClient();
  const { data: assessments } = await supabase.from("assessments").select("id, seq, title, description, status, settings, assessment_questions(marks)").order("seq", { ascending: false });
  const db = createAdminClient();
  const { data: attempts } = await db.from("assessment_attempts").select("id, assessment_id, status, submitted_at, attempt_no").eq("student_id", studentId).order("attempt_no", { ascending: false });
  return (assessments ?? []).map((a) => {
    const settings = parseQuizSettings(a.settings);
    const mine = (attempts ?? []).filter((t) => t.assessment_id === a.id);
    return {
      id: a.id,
      seq: a.seq,
      title: a.title,
      description: a.description,
      questionCount: a.assessment_questions.length,
      totalMarks: a.assessment_questions.reduce((s, q) => s + Number(q.marks), 0),
      timerMinutes: settings.timer_minutes,
      maxAttempts: settings.max_attempts,
      attemptsUsed: mine.length,
      openAttemptId: mine.find((t) => t.status === "in_progress")?.id ?? null,
      lastSubmittedAttemptId: mine.find((t) => t.status === "submitted")?.id ?? null,
      status: a.status,
    };
  });
}
