import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface AdminAnalytics {
  codingQuestions: { total: number; published: number; draft: number };
  mcqQuestions: { total: number; published: number; draft: number };
  quizzes: { published: number; draft: number };
  submittedCoding: number;
  submittedQuizzes: number;
  pendingReviews: number;
  acceptedProblems: number;
  acceptanceRate: number | null;
  avgQuizPct: number | null;
  mcqAccuracy: number | null;
  frequentlyFailed: { title: string; submissions: number; accepted: number; failRate: number }[];
  weakTopics: { topic: string; kind: string; rate: number; n: number }[];
  perDay: { day: string; submissions: number; accepted: number }[];
  recent: { kind: "code" | "quiz"; id: string; title: string; detail: string; at: string }[];
}

/** All figures are computed from real rows via the admin's RLS-scoped client. */
export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const supabase = await createClient();
  const [qs, quizzes, codeSubs, attempts, grades, reviews] = await Promise.all([
    supabase.from("questions").select("id, type, status"),
    supabase.from("assessments").select("id, status"),
    supabase.from("code_submissions").select("id, status, verdict, submitted_at, v:question_versions(question_id, title, topic)").order("submitted_at", { ascending: false }),
    supabase.from("assessment_attempts").select("id, score, max_score, submitted_at, a:assessments(title)").eq("status", "submitted").order("submitted_at", { ascending: false }),
    supabase.from("attempt_grades").select("is_correct, v:question_versions(topic)"),
    supabase.from("reviews").select("code_submission_id, attempt_id"),
  ]);

  const count = (type: string) => {
    const rows = (qs.data ?? []).filter((q) => q.type === type);
    return { total: rows.length, published: rows.filter((q) => q.status === "published").length, draft: rows.filter((q) => q.status === "draft").length };
  };

  const done = (codeSubs.data ?? []).filter((s) => s.status === "completed");
  const reviewedCode = new Set((reviews.data ?? []).map((r) => r.code_submission_id).filter(Boolean));
  const reviewedAttempt = new Set((reviews.data ?? []).map((r) => r.attempt_id).filter(Boolean));
  const pendingCode = done.filter((s) => !reviewedCode.has(s.id)).length;
  const pendingQuiz = (attempts.data ?? []).filter((t) => !reviewedAttempt.has(t.id)).length;

  const accepted = new Set(done.filter((s) => s.verdict === "accepted").map((s) => s.v?.question_id));
  const byProblem = new Map<string, { title: string; submissions: number; accepted: number }>();
  const byTopic = new Map<string, { n: number; ok: number }>();
  for (const s of done) {
    const qid = s.v?.question_id;
    if (!qid) continue;
    const row = byProblem.get(qid) ?? byProblem.set(qid, { title: s.v?.title ?? "", submissions: 0, accepted: 0 }).get(qid)!;
    row.submissions++;
    if (s.verdict === "accepted") row.accepted++;
    const t = s.v?.topic?.trim() || "General";
    const tr = byTopic.get(`coding|${t}`) ?? byTopic.set(`coding|${t}`, { n: 0, ok: 0 }).get(`coding|${t}`)!;
    tr.n++;
    if (s.verdict === "accepted") tr.ok++;
  }
  for (const g of grades.data ?? []) {
    const t = g.v?.topic?.trim() || "General";
    const tr = byTopic.get(`mcq|${t}`) ?? byTopic.set(`mcq|${t}`, { n: 0, ok: 0 }).get(`mcq|${t}`)!;
    tr.n++;
    if (g.is_correct) tr.ok++;
  }

  const days = new Map<string, { submissions: number; accepted: number }>();
  const since = Date.now() - 29 * 86_400_000;
  for (let i = 0; i < 30; i++) days.set(new Date(since + i * 86_400_000).toISOString().slice(0, 10), { submissions: 0, accepted: 0 });
  for (const s of done) {
    const d = days.get(s.submitted_at.slice(0, 10));
    if (!d) continue;
    d.submissions++;
    if (s.verdict === "accepted") d.accepted++;
  }

  const pcts = (attempts.data ?? []).filter((t) => t.max_score && Number(t.max_score) > 0).map((t) => (Number(t.score) / Number(t.max_score)) * 100);
  const gAll = grades.data ?? [];

  return {
    codingQuestions: count("coding"),
    mcqQuestions: count("mcq"),
    quizzes: { published: (quizzes.data ?? []).filter((a) => a.status === "published").length, draft: (quizzes.data ?? []).filter((a) => a.status === "draft").length },
    submittedCoding: done.length,
    submittedQuizzes: attempts.data?.length ?? 0,
    pendingReviews: pendingCode + pendingQuiz,
    acceptedProblems: accepted.size,
    acceptanceRate: done.length ? (done.filter((s) => s.verdict === "accepted").length / done.length) * 100 : null,
    avgQuizPct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
    mcqAccuracy: gAll.length ? (gAll.filter((g) => g.is_correct).length / gAll.length) * 100 : null,
    frequentlyFailed: [...byProblem.values()].map((p) => ({ ...p, failRate: p.submissions ? ((p.submissions - p.accepted) / p.submissions) * 100 : 0 })).filter((p) => p.submissions >= 1 && p.failRate > 0).sort((a, b) => b.failRate - a.failRate || b.submissions - a.submissions).slice(0, 8),
    weakTopics: [...byTopic.entries()].map(([k, v]) => { const [kind, topic] = k.split("|"); return { topic, kind, rate: (v.ok / v.n) * 100, n: v.n }; }).sort((a, b) => a.rate - b.rate).slice(0, 8),
    perDay: [...days.entries()].map(([day, v]) => ({ day, ...v })),
    recent: [
      ...(codeSubs.data ?? []).slice(0, 8).map((s) => ({ kind: "code" as const, id: s.id, title: s.v?.title ?? "Problem", detail: s.status === "completed" ? (s.verdict ?? "").replace(/_/g, " ") : s.status, at: s.submitted_at })),
      ...(attempts.data ?? []).slice(0, 8).map((t) => ({ kind: "quiz" as const, id: t.id, title: t.a?.title ?? "Quiz", detail: `${t.score}/${t.max_score}`, at: t.submitted_at ?? "" })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8),
  };
}
