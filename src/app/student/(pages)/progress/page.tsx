import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Panel, PanelHeader, Stat } from "@/components/ui/panel";
import { requireStudent } from "@/lib/auth/session";
import { getProgress } from "@/lib/student/progress";
import { pct } from "@/lib/utils";
import Link from "next/link";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Progress" };

const fmt = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);

export default async function ProgressPage() {
  const user = await requireStudent();
  const p = await getProgress(user.id);
  const empty = p.submissionsTotal === 0 && p.quizzesSubmitted === 0;
  return (
    <>
      <PageHeader title="Progress" description="Calculated from your real submissions. Quiz figures only include results you're allowed to see." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Problems attempted" value={`${p.problemsAttempted}/${p.problemsPublished}`} />
        <Stat label="Problems solved" value={p.problemsSolved} />
        <Stat label="Coding acceptance rate" value={fmt(p.acceptanceRate)} hint={`${p.acceptedSubmissions} of ${p.submissionsTotal} submissions`} />
        <Stat label="Feedback received" value={p.feedbackCount} />
        <Stat label="MCQ accuracy" value={fmt(p.mcqAccuracy)} hint={p.mcqAnswered ? `${p.mcqCorrect}/${p.mcqAnswered} answered` : "after answers are released"} />
        <Stat label="Quizzes submitted" value={p.quizzesSubmitted} />
        <Stat label="Average quiz score" value={fmt(p.avgQuizPct)} />
      </div>
      {empty ? (
        <div className="mt-6"><EmptyState title="Nothing to chart yet">Solve a problem or take a quiz and your progress will show up here.</EmptyState></div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="By difficulty (coding)" />
            <table className="table-dense w-full text-sm"><thead><tr><th>Level</th><th>Solved</th><th>Published</th><th>Completion</th></tr></thead>
              <tbody>{p.byDifficulty.map((d) => (<tr key={d.level}><td className="capitalize">{d.level}</td><td className="tabular-nums">{d.solved}</td><td className="tabular-nums text-muted">{d.published}</td><td className="tabular-nums">{pct(d.solved, d.published)}</td></tr>))}</tbody></table>
          </Panel>
          <Panel>
            <PanelHeader title="By topic" />
            {p.byTopic.length === 0 ? <p className="p-4 text-sm text-muted">No topic data yet.</p> : (
              <table className="table-dense w-full text-sm"><thead><tr><th>Topic</th><th>Coding solved</th><th>MCQ accuracy</th></tr></thead>
                <tbody>{p.byTopic.map((t) => (<tr key={t.topic}><td>{t.topic}</td><td className="tabular-nums">{t.solved}/{t.attempted}</td><td className="tabular-nums">{t.mcqTotal ? `${pct(t.mcqCorrect, t.mcqTotal)} (${t.mcqCorrect}/${t.mcqTotal})` : "—"}</td></tr>))}</tbody></table>
            )}
          </Panel>
          <Panel className="lg:col-span-2">
            <PanelHeader title="Recent activity" />
            <ul className="divide-y divide-border text-sm">
              {p.recent.map((r, i) => (
                <li key={i}><Link href={r.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"><Badge>{r.kind === "code" ? "Code" : "Quiz"}</Badge><span className="font-medium">{r.title}</span><span className="text-muted capitalize">{r.detail}</span><span className="ml-auto text-xs text-muted">{formatDateTime(r.at)}</span></Link></li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
