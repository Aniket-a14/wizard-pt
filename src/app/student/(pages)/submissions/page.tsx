import Link from "next/link";
import { Badge, ReviewBadge, VerdictBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { requireStudent } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Submissions" };

export default async function SubmissionHistory() {
  const user = await requireStudent();
  const supabase = await createClient();
  const [subs, reviews] = await Promise.all([
    supabase.from("code_submissions").select("id, status, verdict, score_pct, submitted_at, v:question_versions(title, version)").eq("student_id", user.id).order("submitted_at", { ascending: false }).limit(200),
    supabase.from("reviews").select("code_submission_id, status").not("code_submission_id", "is", null).not("published_at", "is", null),
  ]);
  const rv = new Map((reviews.data ?? []).map((r) => [r.code_submission_id, r.status]));
  const db = createAdminClient();
  const attempts = await db.from("assessment_attempts").select("id, assessment_id, attempt_no, submitted_at, a:assessments(title)").eq("student_id", user.id).eq("status", "submitted").order("submitted_at", { ascending: false });
  return (
    <>
      <PageHeader title="Submission history" description="Every submission is a permanent snapshot of the code you submitted." />
      <div className="space-y-5">
        <Panel>
          <PanelHeader title={`Coding (${subs.data?.length ?? 0})`} />
          {(subs.data?.length ?? 0) === 0 ? <div className="p-4"><EmptyState title="No submissions yet" /></div> : (
            <table className="table-dense w-full text-sm">
              <thead><tr><th>Problem</th><th>Result</th><th>Score</th><th>Feedback</th><th>Submitted</th></tr></thead>
              <tbody>
                {subs.data!.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/student/submissions/${s.id}`} className="font-medium hover:text-accent hover:underline">{s.v?.title}</Link>{(s.v?.version ?? 1) > 1 && <span className="ml-2 text-xs text-muted">v{s.v?.version}</span>}</td>
                    <td><VerdictBadge verdict={s.status === "queued" || s.status === "running" ? null : s.verdict} /></td>
                    <td className="tabular-nums">{s.score_pct === null ? "—" : `${s.score_pct}%`}</td>
                    <td>{rv.has(s.id) ? <ReviewBadge status={rv.get(s.id)} /> : <span className="text-xs text-muted">—</span>}</td>
                    <td className="text-muted">{formatDateTime(s.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={`Quizzes (${attempts.data?.length ?? 0})`} />
          {(attempts.data?.length ?? 0) === 0 ? <div className="p-4"><EmptyState title="No quiz attempts yet" /></div> : (
            <ul className="divide-y divide-border text-sm">
              {attempts.data!.map((t) => (
                <li key={t.id}><Link href={`/student/quizzes/${t.assessment_id}?attempt=${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"><span className="font-medium">{t.a?.title}</span><Badge>attempt {t.attempt_no}</Badge><span className="ml-auto text-xs text-muted">{formatDateTime(t.submitted_at)}</span></Link></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
