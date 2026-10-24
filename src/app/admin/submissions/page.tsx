import Link from "next/link";
import { ReviewBadge, VerdictBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Submissions" };

export default async function Submissions({ searchParams }: PageProps<"/admin/submissions">) {
  const sp = await searchParams;
  const tab = sp.tab === "quiz" ? "quiz" : "code";
  const rv = typeof sp.review === "string" ? sp.review : "all";
  const supabase = await createClient();

  const [code, quiz] = await Promise.all([
    supabase.from("code_submissions").select("id, status, verdict, score_pct, submitted_at, student:profiles!code_submissions_student_id_fkey(display_name), v:question_versions(title, version), review:reviews(status, published_at)").order("submitted_at", { ascending: false }).limit(300),
    supabase.from("assessment_attempts").select("id, attempt_no, score, max_score, submitted_at, status, student:profiles!assessment_attempts_student_id_fkey(display_name), a:assessments(title), review:reviews(status, published_at)").eq("status", "submitted").order("submitted_at", { ascending: false }).limit(300),
  ]);
  const reviewOf = (r: unknown) => (Array.isArray(r) ? r[0] : r) as { status: string; published_at: string | null } | null | undefined;
  const filt = <T extends { review: unknown }>(rows: T[]) => rows.filter((x) => (rv === "pending" ? !reviewOf(x.review) : rv === "reviewed" ? !!reviewOf(x.review) : true));
  const codeRows = filt(code.data ?? []);
  const quizRows = filt(quiz.data ?? []);
  const pendingCode = (code.data ?? []).filter((x) => !reviewOf(x.review) && x.status === "completed").length;
  const pendingQuiz = (quiz.data ?? []).filter((x) => !reviewOf(x.review)).length;

  const tabLink = (t: string, label: string, n: number) => (
    <Link href={`/admin/submissions?tab=${t}&review=${rv}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-foreground")}>{label} {n > 0 && <span className="ml-1 rounded-full bg-warning-soft px-1.5 text-xs text-warning">{n} pending</span>}</Link>
  );
  const chip = (v: string, label: string) => (
    <Link href={`/admin/submissions?tab=${tab}&review=${v}`} className={cn("rounded-full border px-2.5 py-0.5 text-xs", rv === v ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:bg-surface-2")}>{label}</Link>
  );

  return (
    <>
      <PageHeader title="Submissions" description="Automatic results and your manual review are tracked separately." />
      <div className="mb-3 flex items-center justify-between border-b border-border">
        <div className="flex">{tabLink("code", "Coding", pendingCode)}{tabLink("quiz", "Quizzes", pendingQuiz)}</div>
        <div className="mb-1 flex gap-2">{chip("all", "All")}{chip("pending", "Pending review")}{chip("reviewed", "Reviewed")}</div>
      </div>
      {tab === "code" ? (
        codeRows.length === 0 ? <EmptyState title="No coding submissions match" /> : (
          <Panel className="overflow-x-auto">
            <table className="table-dense w-full text-sm">
              <thead><tr><th>Submitted</th><th>Student</th><th>Problem</th><th>Auto result</th><th>Score</th><th>Review</th></tr></thead>
              <tbody>
                {codeRows.map((s) => {
                  const r = reviewOf(s.review);
                  return (
                    <tr key={s.id}>
                      <td className="text-muted">{formatDateTime(s.submitted_at)}</td>
                      <td>{s.student?.display_name}</td>
                      <td><Link href={`/admin/submissions/code/${s.id}`} className="font-medium hover:text-accent hover:underline">{s.v?.title}</Link>{(s.v?.version ?? 1) > 1 && <span className="ml-1 text-xs text-muted">v{s.v?.version}</span>}</td>
                      <td><VerdictBadge verdict={s.status === "queued" || s.status === "running" ? null : s.verdict} /></td>
                      <td className="tabular-nums">{s.score_pct === null ? "—" : `${s.score_pct}%`}</td>
                      <td><ReviewBadge status={r ? r.status : "pending_review"} />{r && !r.published_at && <span className="ml-1 text-xs text-warning">unpublished</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        )
      ) : quizRows.length === 0 ? <EmptyState title="No quiz submissions match" /> : (
        <Panel className="overflow-x-auto">
          <table className="table-dense w-full text-sm">
            <thead><tr><th>Submitted</th><th>Student</th><th>Quiz</th><th>Score</th><th>Review</th></tr></thead>
            <tbody>
              {quizRows.map((t) => {
                const r = reviewOf(t.review);
                return (
                  <tr key={t.id}>
                    <td className="text-muted">{formatDateTime(t.submitted_at)}</td>
                    <td>{t.student?.display_name}</td>
                    <td><Link href={`/admin/submissions/quiz/${t.id}`} className="font-medium hover:text-accent hover:underline">{t.a?.title}</Link><span className="ml-1 text-xs text-muted">attempt {t.attempt_no}</span></td>
                    <td className="tabular-nums">{t.score}/{t.max_score}</td>
                    <td><ReviewBadge status={r ? r.status : "pending_review"} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
