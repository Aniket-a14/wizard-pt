import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/ui/markdown";
import { PageHeader, Panel, PanelHeader, Stat } from "@/components/ui/panel";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDateTime, pct } from "@/lib/utils";
import { ReviewForm } from "../../review-form";

export const metadata = { title: "Quiz submission" };

export default async function QuizSubmission({ params }: PageProps<"/admin/submissions/quiz/[id]">) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const t = await supabase.from("assessment_attempts").select("*, student:profiles!assessment_attempts_student_id_fkey(display_name), a:assessments(title)").eq("id", id).maybeSingle();
  if (!t.data) notFound();
  const att = t.data;
  const ids = att.question_order;
  const [versions, options, keys, answers, grades, review] = await Promise.all([
    supabase.from("question_versions").select("id, statement_md, code_snippet, topic").in("id", ids),
    supabase.from("mcq_options").select("id, question_version_id, option_text, display_order").in("question_version_id", ids).order("display_order"),
    supabase.from("mcq_correct_options").select("option_id").in("question_version_id", ids),
    supabase.from("attempt_answers").select("question_version_id, selected_option_ids, marked_for_review").eq("attempt_id", id),
    supabase.from("attempt_grades").select("*").eq("attempt_id", id),
    supabase.from("reviews").select("*").eq("attempt_id", id).maybeSingle(),
  ]);
  const correct = new Set((keys.data ?? []).map((k) => k.option_id));
  const aBy = new Map((answers.data ?? []).map((a) => [a.question_version_id, a]));
  const gBy = new Map((grades.data ?? []).map((g) => [g.question_version_id, g]));
  const total = grades.data?.length ?? 0;
  const right = grades.data?.filter((g) => g.is_correct).length ?? 0;
  const unanswered = ids.filter((v) => (aBy.get(v)?.selected_option_ids.length ?? 0) === 0).length;
  const r = review.data;

  return (
    <>
      <PageHeader title={`${att.a?.title} — attempt ${att.attempt_no}`} description={`${att.student?.display_name} · submitted ${formatDateTime(att.submitted_at)}${att.auto_submitted ? " (auto, timer ended)" : ""}`} actions={<Link href="/admin/submissions?tab=quiz" className="text-sm text-accent underline">← All submissions</Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Score" value={`${att.score}/${att.max_score}`} />
        <Stat label="Accuracy" value={pct(right, total)} hint={`${right} of ${total} correct`} />
        <Stat label="Unanswered" value={unanswered} />
        <Stat label="Percent" value={att.max_score && Number(att.max_score) > 0 ? `${Math.round((Number(att.score) / Number(att.max_score)) * 100)}%` : "—"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {ids.map((vid, i) => {
            const v = versions.data?.find((x) => x.id === vid);
            const g = gBy.get(vid);
            const sel = new Set(aBy.get(vid)?.selected_option_ids ?? []);
            return (
              <Panel key={vid}>
                <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
                  <span className="font-medium">Q{i + 1}{aBy.get(vid)?.marked_for_review && <Badge tone="warning" className="ml-2">marked</Badge>}</span>
                  <span className={cn("tabular-nums", g?.is_correct ? "text-success" : "text-muted")}>{g ? `${Number(g.awarded_marks)}/${Number(g.max_marks)}` : "—"}{sel.size === 0 && <span className="ml-2 text-xs">unanswered</span>}</span>
                </div>
                <div className="space-y-2 p-4">
                  <Markdown>{v?.statement_md ?? ""}</Markdown>
                  {v?.code_snippet && <pre className="code-block">{v.code_snippet}</pre>}
                  <ul className="space-y-1">
                    {(options.data ?? []).filter((o) => o.question_version_id === vid).map((o, k) => (
                      <li key={o.id} className={cn("flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm", correct.has(o.id) ? "border-success bg-success-soft" : sel.has(o.id) ? "border-danger bg-danger-soft" : "border-border")}>
                        <span className="w-5 font-mono text-xs text-muted">{String.fromCharCode(65 + k)}</span><span className="flex-1">{o.option_text}</span>
                        {sel.has(o.id) && <Badge tone={correct.has(o.id) ? "success" : "danger"}>chosen</Badge>}{correct.has(o.id) && <Badge tone="success">key</Badge>}
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>
            );
          })}
        </div>
        <div className="space-y-5">
          <ReviewForm target="quiz" id={id} initial={r ? { status: r.status as "reviewed", marks: r.marks === null ? null : Number(r.marks), maxMarks: r.max_marks === null ? null : Number(r.max_marks), comments: r.comments ?? "", suggestions: r.suggestions ?? "", explanation: r.explanation ?? "", publishedAt: r.published_at } : null} defaultMax={att.max_score === null ? null : Number(att.max_score)} suggestedMarks={att.score === null ? null : Number(att.score)} />
          <Panel><PanelHeader title="About this score" /><p className="p-4 text-xs text-muted">Marks were calculated automatically from the answer keys and the quiz&apos;s marking rules. Your review is separate and optional.</p></Panel>
        </div>
      </div>
    </>
  );
}
