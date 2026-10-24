import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CodeViewer } from "@/components/code-editor";
import { isLang, LANG_META } from "@/lib/coding/languages";
import { Badge, DifficultyBadge, ReviewBadge, VerdictBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { requireStudent } from "@/lib/auth/session";
import { VERDICT_LABEL, type Verdict } from "@/lib/coding/score";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Submission" };

interface Row { testId: string; visibility: string; status: string; timeMs: number | null; index: number; input?: string; expected?: string; actual?: string | null; message?: string }

export default async function SubmissionDetail({ params }: PageProps<"/student/submissions/[id]">) {
  const user = await requireStudent();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const s = await supabase.from("code_submissions").select("*, v:question_versions(id, question_id, version, title, difficulty)").eq("id", id).eq("student_id", user.id).maybeSingle();
  if (!s.data) notFound();
  const sub = s.data;
  const lang = isLang(sub.language) ? sub.language : "java";
  const [review, others] = await Promise.all([
    supabase.from("reviews").select("status, marks, max_marks, comments, suggestions, explanation, published_at").eq("code_submission_id", id).not("published_at", "is", null).maybeSingle(),
    supabase.from("code_submissions").select("id, verdict, score_pct, submitted_at, v:question_versions!inner(question_id)").eq("student_id", user.id).eq("v.question_id", sub.v?.question_id ?? "").order("submitted_at", { ascending: false }),
  ]);
  const results = (Array.isArray(sub.results) ? sub.results : []) as unknown as Row[];
  const verdict = sub.verdict as Verdict | null;

  return (
    <>
      <PageHeader
        title={sub.v?.title ?? "Submission"}
        description={`Submitted ${formatDateTime(sub.submitted_at)}${sub.v ? ` · problem version ${sub.v.version}` : ""}`}
        actions={sub.v && <Link href={`/student/problems/${sub.v.question_id}`} className={buttonVariants({ variant: "primary" })}>Open problem</Link>}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Automatic evaluation" actions={<VerdictBadge verdict={sub.status === "queued" || sub.status === "running" ? null : verdict} />} />
            <div className="space-y-3 p-4 text-sm">
              {sub.status === "queued" || sub.status === "running" ? (
                <p className="text-muted">Waiting for evaluation. Your code is saved; you&apos;ll get a notification when your instructor has graded it.</p>
              ) : (
                <>
                  <div className="text-lg font-semibold">{verdict ? VERDICT_LABEL[verdict] : "—"}</div>
                  {sub.error_message && <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">{sub.error_message}</p>}
                  <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Stat label="Public tests" value={`${sub.passed_public ?? 0}/${sub.total_public ?? 0}`} />
                    <Stat label="Hidden tests" value={`${sub.passed_hidden ?? 0}/${sub.total_hidden ?? 0}`} />
                    <Stat label="Score" value={sub.score_pct === null ? "—" : `${sub.score_pct}%`} />
                    <Stat label="Time" value={sub.exec_time_ms === null ? "—" : `${sub.exec_time_ms} ms`} />
                  </dl>
                  {sub.compile_output && <pre className="code-block text-red-300">{sub.compile_output}</pre>}
                  {results.length > 0 && (
                    <table className="table-dense w-full text-sm">
                      <thead><tr><th>Test</th><th>Result</th><th>Time</th></tr></thead>
                      <tbody>
                        {results.map((r) => (
                          <tr key={r.testId}>
                            <td>{r.visibility === "hidden" ? `Hidden ${r.index}` : `Public ${r.index}`}</td>
                            <td className={r.status === "passed" ? "text-success" : "text-danger"}>{r.status.replace(/_/g, " ")}</td>
                            <td className="tabular-nums text-muted">{r.timeMs ?? "—"} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Your submitted code (exact snapshot)" />
            <div className="p-4"><CodeViewer code={sub.source_code} language={LANG_META[lang].monaco} /></div>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Instructor feedback" actions={review.data ? <ReviewBadge status={review.data.status} /> : undefined} />
            <div className="space-y-3 p-4 text-sm">
              {!review.data ? (
                <p className="text-muted">No feedback published yet. You&apos;ll be notified when there is.</p>
              ) : (
                <>
                  {review.data.marks !== null && <div><div className="text-xs text-muted">Final marks</div><div className="text-lg font-semibold tabular-nums">{Number(review.data.marks)}{review.data.max_marks !== null && ` / ${Number(review.data.max_marks)}`}</div></div>}
                  {review.data.comments && <FB label="Comments" text={review.data.comments} />}
                  {review.data.suggestions && <FB label="Suggestions" text={review.data.suggestions} />}
                  {review.data.explanation && <FB label="Explanation" text={review.data.explanation} />}
                  <p className="text-xs text-muted">Published {formatDateTime(review.data.published_at)}</p>
                </>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="All attempts on this problem" />
            <ul className="divide-y divide-border text-sm">
              {(others.data ?? []).map((o) => (
                <li key={o.id}>
                  <Link href={`/student/submissions/${o.id}`} className={`flex items-center gap-2 px-4 py-2 hover:bg-surface-2 ${o.id === id ? "bg-surface-2 font-medium" : ""}`}>
                    <VerdictBadge verdict={o.verdict} /><span className="tabular-nums">{o.score_pct === null ? "—" : `${o.score_pct}%`}</span>
                    <span className="ml-auto text-xs text-muted">{formatDateTime(o.submitted_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          {sub.v && <div className="flex items-center gap-2 text-xs text-muted"><DifficultyBadge level={sub.v.difficulty} /> <Badge>{LANG_META[lang].label}</Badge></div>}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>;
}
function FB({ label, text }: { label: string; text: string }) {
  return <div><div className="text-xs text-muted">{label}</div><p className="whitespace-pre-wrap">{text}</p></div>;
}
