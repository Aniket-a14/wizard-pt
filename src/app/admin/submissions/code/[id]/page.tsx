import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CodeViewer } from "@/components/code-editor";
import { Badge, ReviewBadge, VerdictBadge } from "@/components/ui/badge";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { diffLines } from "@/lib/diff";
import { VERDICT_LABEL, type Verdict } from "@/lib/coding/score";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDateTime } from "@/lib/utils";
import { ReviewForm } from "../../review-form";

export const metadata = { title: "Coding submission" };

interface Detail { testId: string; visibility: string; status: string; timeMs: number | null; input: string; expected: string; actual: string | null; stderr: string; studentStdout: string; message?: string }

export default async function CodeSubmission({ params, searchParams }: PageProps<"/admin/submissions/code/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const s = await supabase.from("code_submissions").select("*, student:profiles!code_submissions_student_id_fkey(display_name), v:question_versions(id, question_id, version, title, marks)").eq("id", id).maybeSingle();
  if (!s.data) notFound();
  const sub = s.data;
  const [priv, review, siblings] = await Promise.all([
    supabase.from("code_submission_private").select("detailed_results").eq("submission_id", id).maybeSingle(),
    supabase.from("reviews").select("*").eq("code_submission_id", id).maybeSingle(),
    supabase.from("code_submissions").select("id, verdict, score_pct, submitted_at, source_code, v:question_versions!inner(question_id)").eq("student_id", sub.student_id).eq("v.question_id", sub.v?.question_id ?? "").order("submitted_at", { ascending: false }),
  ]);
  const details = (Array.isArray(priv.data?.detailed_results) ? priv.data!.detailed_results : []) as unknown as Detail[];
  const compareId = typeof sp.compare === "string" ? sp.compare : null;
  const other = compareId ? siblings.data?.find((x) => x.id === compareId) : null;
  const diff = other ? diffLines(other.source_code, sub.source_code) : null;
  const verdict = sub.verdict as Verdict | null;
  const r = review.data;

  return (
    <>
      <PageHeader title={sub.v?.title ?? "Submission"} description={`${sub.student?.display_name} · ${formatDateTime(sub.submitted_at)} · problem v${sub.v?.version} · ${sub.language}`}
        actions={<Link href="/admin/submissions" className="text-sm text-accent underline">← All submissions</Link>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Automatic evaluation" actions={<VerdictBadge verdict={sub.status === "queued" || sub.status === "running" ? null : verdict} />} />
            <div className="space-y-3 p-4 text-sm">
              <div className="text-lg font-semibold">{verdict ? VERDICT_LABEL[verdict] : sub.status}</div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <KV k="Score" v={sub.score_pct === null ? "—" : `${sub.score_pct}%`} />
                <KV k="Auto marks" v={sub.marks_awarded === null ? "—" : `${sub.marks_awarded}/${sub.max_marks}`} />
                <KV k="Public" v={`${sub.passed_public ?? 0}/${sub.total_public ?? 0}`} />
                <KV k="Hidden" v={`${sub.passed_hidden ?? 0}/${sub.total_hidden ?? 0}`} />
                <KV k="Runtime" v={sub.exec_time_ms === null ? "—" : `${sub.exec_time_ms} ms`} />
              </dl>
              {sub.memory_kb != null && <p className="text-xs text-muted">Peak memory {sub.memory_kb} KB</p>}
              {sub.compile_output && <pre className="code-block text-red-300">{sub.compile_output}</pre>}
              {sub.status === "system_error" && <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">The runner failed for this submission (not graded). Internal detail: {JSON.stringify((priv.data?.detailed_results as { systemError?: string } | null)?.systemError ?? "n/a")}</p>}
            </div>
            {details.length > 0 && (
              <div className="overflow-x-auto border-t border-border">
                <table className="table-dense w-full text-xs">
                  <thead><tr><th>#</th><th>Vis.</th><th>Status</th><th>Input</th><th>Expected</th><th>Actual</th><th>ms</th></tr></thead>
                  <tbody>
                    {details.map((d, i) => (
                      <tr key={d.testId} className="align-top">
                        <td>{i + 1}</td><td>{d.visibility}</td>
                        <td className={d.status === "passed" ? "text-success" : "text-danger"}>{d.status.replace(/_/g, " ")}</td>
                        <td className="max-w-40"><pre className="whitespace-pre-wrap break-all font-mono">{d.input.length > 200 ? d.input.slice(0, 200) + "…" : d.input}</pre></td>
                        <td className="max-w-40"><pre className="whitespace-pre-wrap break-all font-mono">{d.expected.length > 200 ? d.expected.slice(0, 200) + "…" : d.expected}</pre></td>
                        <td className="max-w-40"><pre className="whitespace-pre-wrap break-all font-mono">{(d.actual ?? d.stderr ?? "").slice(0, 200)}</pre></td>
                        <td className="tabular-nums">{d.timeMs ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Submitted source (read-only, exact snapshot)" />
            <div className="p-4"><CodeViewer code={sub.source_code} /></div>
          </Panel>

          {diff && other && (
            <Panel>
              <PanelHeader title={`Changes since attempt from ${formatDateTime(other.submitted_at)}`} actions={<Link href={`/admin/submissions/code/${id}`} className="text-xs text-accent underline">Close</Link>} />
              <pre className="overflow-x-auto p-4 font-mono text-xs leading-5">
                {diff.map((d, i) => (<div key={i} className={cn("px-2", d.type === "add" && "bg-success-soft text-success", d.type === "del" && "bg-danger-soft text-danger")}>{d.type === "add" ? "+ " : d.type === "del" ? "- " : "  "}{d.text}</div>))}
              </pre>
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          <ReviewForm target="code" id={id} initial={r ? { status: r.status as "reviewed", marks: r.marks === null ? null : Number(r.marks), maxMarks: r.max_marks === null ? null : Number(r.max_marks), comments: r.comments ?? "", suggestions: r.suggestions ?? "", explanation: r.explanation ?? "", publishedAt: r.published_at } : null}
            defaultMax={sub.v ? Number(sub.v.marks) : null} suggestedMarks={sub.marks_awarded === null ? null : Number(sub.marks_awarded)} />
          <Panel>
            <PanelHeader title="Attempts on this problem" />
            <ul className="divide-y divide-border text-sm">
              {(siblings.data ?? []).map((o) => (
                <li key={o.id} className={cn("flex items-center gap-2 px-4 py-2", o.id === id && "bg-surface-2")}>
                  <Link href={`/admin/submissions/code/${o.id}`} className="flex flex-1 items-center gap-2 hover:underline"><VerdictBadge verdict={o.verdict} /><span className="tabular-nums">{o.score_pct === null ? "—" : `${o.score_pct}%`}</span><span className="text-xs text-muted">{formatDateTime(o.submitted_at)}</span></Link>
                  {o.id !== id && <Link href={`/admin/submissions/code/${id}?compare=${o.id}`} className="text-xs text-accent underline">compare</Link>}
                </li>
              ))}
            </ul>
          </Panel>
          {r && <div className="text-xs text-muted">Current review: <ReviewBadge status={r.status} /> <Badge>{r.published_at ? "published" : "draft"}</Badge></div>}
        </div>
      </div>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>;
}
