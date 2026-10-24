import Link from "next/link";
import { Badge, DifficultyBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { requireStudent } from "@/lib/auth/session";
import { listProblems, listQuizzes } from "@/lib/student/data";
import { cn } from "@/lib/utils";

export const metadata = { title: "Assessments" };

const STATE = {
  new: { label: "Not started", tone: "neutral" },
  attempted: { label: "Attempted", tone: "warning" },
  accepted: { label: "Solved", tone: "success" },
} as const;

export default async function Assessments() {
  const user = await requireStudent();
  const [problems, quizzes] = await Promise.all([listProblems(user.id), listQuizzes(user.id)]);
  return (
    <>
      <PageHeader title="Assessments" description="New problems and quizzes appear here as soon as they are published." />
      <div className="space-y-6">
        <Panel>
          <PanelHeader title={`Coding problems (${problems.length})`} />
          {problems.length === 0 ? (
            <div className="p-4"><EmptyState title="No problems published yet">When your instructor publishes one, it shows up here automatically.</EmptyState></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dense w-full text-sm">
                <thead><tr><th>Status</th><th>Title</th><th>Difficulty</th><th>Topic</th><th>Best score</th><th>Submissions</th><th></th></tr></thead>
                <tbody>
                  {problems.map((p) => (
                    <tr key={p.questionId}>
                      <td><Badge tone={STATE[p.state].tone}>{STATE[p.state].label}</Badge></td>
                      <td>
                        <Link href={`/student/problems/${p.questionId}`} className="font-medium hover:text-accent hover:underline">{p.title}</Link>
                        {p.company && <span className="ml-2 text-xs text-muted">{p.company}</span>}
                        {p.hasFeedback && <Badge tone="accent" className="ml-2">feedback</Badge>}
                      </td>
                      <td><DifficultyBadge level={p.difficulty} /></td>
                      <td className="text-muted">{p.topic ?? "—"}</td>
                      <td className="tabular-nums">{p.bestScore === null ? "—" : `${p.bestScore}%`}</td>
                      <td className="tabular-nums text-muted">{p.submissions}</td>
                      <td className="text-right"><Link href={`/student/problems/${p.questionId}`} className={buttonVariants({ size: "sm", variant: p.state === "new" ? "primary" : "secondary" })}>{p.state === "new" ? "Solve" : "Open"}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHeader title={`Quizzes (${quizzes.length})`} />
          {quizzes.length === 0 ? (
            <div className="p-4"><EmptyState title="No quizzes yet" /></div>
          ) : (
            <ul className="divide-y divide-border">
              {quizzes.map((q) => {
                const done = q.attemptsUsed >= q.maxAttempts && !q.openAttemptId;
                return (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <Link href={`/student/quizzes/${q.id}`} className="font-medium hover:text-accent hover:underline">{q.title}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>{q.questionCount} questions</span><span>{q.totalMarks} marks</span>
                        {q.timerMinutes && <span>{q.timerMinutes} min</span>}
                        <span>{q.attemptsUsed}/{q.maxAttempts} attempts used</span>
                        {q.status === "archived" && <Badge>archived</Badge>}
                      </div>
                    </div>
                    <Link href={`/student/quizzes/${q.id}`} className={cn(buttonVariants({ size: "sm", variant: q.openAttemptId || (!done && q.attemptsUsed === 0) ? "primary" : "secondary" }))}>
                      {q.openAttemptId ? "Resume" : done ? "View result" : q.attemptsUsed === 0 ? "Start" : "Open"}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
