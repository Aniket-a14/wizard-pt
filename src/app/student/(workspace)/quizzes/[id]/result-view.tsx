import Link from "next/link";
import { Badge, ReviewBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import type { AttemptResult } from "@/lib/quiz/server";
import { cn, formatDateTime } from "@/lib/utils";

export function ResultView({ result: r, assessmentId }: { result: AttemptResult; assessmentId: string }) {
  return (
    <>
      <PageHeader
        title={`${r.title} — attempt ${r.attemptNo}`}
        description={`Submitted ${formatDateTime(r.submittedAt)}${r.autoSubmitted ? " (automatically, when the timer ended)" : ""}`}
        actions={<Link href={`/student/quizzes/${assessmentId}`} className={buttonVariants()}>Back to quiz</Link>}
      />
      <div className="space-y-5">
        <Panel className="p-5">
          {r.score ? (
            <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
              <div><div className="text-xs text-muted">Score</div><div className="text-3xl font-semibold tabular-nums">{r.score.score}<span className="text-lg text-muted"> / {r.score.maxScore}</span></div></div>
              <div><div className="text-xs text-muted">Percentage</div><div className="text-xl font-semibold tabular-nums">{r.score.maxScore ? Math.round((r.score.score / r.score.maxScore) * 100) : 0}%</div></div>
              <div className="flex gap-4 text-sm"><span className="text-success">{r.score.correct} correct</span><span className="text-danger">{r.score.incorrect} wrong</span><span className="text-muted">{r.score.unanswered} unanswered</span></div>
            </div>
          ) : (
            <p className="text-sm"><Badge tone="warning">Submitted</Badge> <span className="ml-2 text-muted">Your answers are saved. Your score will appear when your instructor releases the results.</span></p>
          )}
        </Panel>

        {r.feedback && (
          <Panel>
            <PanelHeader title="Instructor feedback" actions={<ReviewBadge status={r.feedback.status} />} />
            <div className="space-y-2 p-4 text-sm">
              {r.feedback.marks !== null && <div className="font-semibold tabular-nums">Final marks: {r.feedback.marks}{r.feedback.maxMarks !== null && ` / ${r.feedback.maxMarks}`}</div>}
              {r.feedback.comments && <p className="whitespace-pre-wrap">{r.feedback.comments}</p>}
              {r.feedback.suggestions && <p className="whitespace-pre-wrap text-muted">{r.feedback.suggestions}</p>}
            </div>
          </Panel>
        )}

        {r.answersPending && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">Correct answers and explanations will be available after your instructor releases them.</p>}

        {r.review && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold">Review</h2>
            {r.review.map((q, i) => (
              <Panel key={q.versionId}>
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="text-sm font-medium">Question {i + 1}</span>
                  <span className={cn("text-sm tabular-nums", q.isCorrect ? "text-success" : q.awarded < 0 ? "text-danger" : "text-muted")}>{q.awarded > 0 ? "+" : ""}{q.awarded} / {q.maxMarks}</span>
                </div>
                <div className="space-y-3 p-4">
                  <Markdown>{q.statement_md}</Markdown>
                  {q.code_snippet && <pre className="code-block">{q.code_snippet}</pre>}
                  <ul className="space-y-1.5">
                    {q.options.map((o, k) => (
                      <li key={o.id} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", o.correct ? "border-success bg-success-soft" : o.selected ? "border-danger bg-danger-soft" : "border-border")}>
                        <span className="w-5 shrink-0 font-mono text-xs text-muted">{String.fromCharCode(65 + k)}</span>
                        <span className="flex-1 whitespace-pre-wrap">{o.text}</span>
                        {o.selected && <Badge tone={o.correct ? "success" : "danger"}>your answer</Badge>}
                        {o.correct && !o.selected && <Badge tone="success">correct</Badge>}
                      </li>
                    ))}
                  </ul>
                  {q.explanation && <div className="rounded-md bg-surface-2 p-3 text-sm"><div className="mb-1 text-xs font-medium text-muted">Explanation</div><Markdown>{q.explanation}</Markdown></div>}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
