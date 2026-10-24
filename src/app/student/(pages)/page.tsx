import Link from "next/link";
import { Badge, DifficultyBadge, VerdictBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PanelHeader, Stat } from "@/components/ui/panel";
import { requireStudent } from "@/lib/auth/session";
import { listProblems, listQuizzes } from "@/lib/student/data";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function StudentHome() {
  const user = await requireStudent();
  const supabase = await createClient();
  const [problems, quizzes, subs, fb] = await Promise.all([
    listProblems(user.id),
    listQuizzes(user.id),
    supabase.from("code_submissions").select("id, status, verdict, score_pct, submitted_at, v:question_versions(title)").eq("student_id", user.id).order("submitted_at", { ascending: false }).limit(5),
    supabase.from("reviews").select("id, status, comments, published_at, code_submission_id, s:code_submissions(v:question_versions(title))").not("published_at", "is", null).order("published_at", { ascending: false }).limit(3),
  ]);
  const fresh = problems.filter((p) => p.state === "new");
  const openQuizzes = quizzes.filter((q) => q.status === "published" && (q.openAttemptId || q.attemptsUsed < q.maxAttempts));
  return (
    <>
      <PageHeader title={`Hi ${user.displayName}`} description="Your practice at a glance." actions={<Link href="/student/assessments" className={buttonVariants({ variant: "primary" })}>Browse assessments</Link>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="New problems" value={fresh.length} />
        <Stat label="Solved" value={problems.filter((p) => p.state === "accepted").length} hint={`of ${problems.length}`} />
        <Stat label="Quizzes available" value={openQuizzes.length} />
        <Stat label="Feedback published" value={fb.data?.length ?? 0} />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Pick up where you left off" />
          {fresh.length + openQuizzes.length === 0 ? <div className="p-4"><EmptyState title="You're all caught up" /></div> : (
            <ul className="divide-y divide-border text-sm">
              {openQuizzes.map((q) => (<li key={q.id}><Link href={`/student/quizzes/${q.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"><Badge tone="accent">Quiz</Badge><span className="font-medium">{q.title}</span><span className="ml-auto text-xs text-muted">{q.openAttemptId ? "in progress" : `${q.questionCount} questions`}</span></Link></li>))}
              {fresh.map((p) => (<li key={p.questionId}><Link href={`/student/problems/${p.questionId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"><DifficultyBadge level={p.difficulty} /><span className="font-medium">{p.title}</span><span className="ml-auto text-xs text-muted">{p.topic}</span></Link></li>))}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Recent submissions" actions={<Link href="/student/submissions" className="text-xs text-accent underline">All</Link>} />
          {(subs.data?.length ?? 0) === 0 ? <div className="p-4"><EmptyState title="No submissions yet" /></div> : (
            <ul className="divide-y divide-border text-sm">
              {subs.data!.map((s) => (<li key={s.id}><Link href={`/student/submissions/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"><VerdictBadge verdict={s.status === "completed" || s.status === "system_error" ? s.verdict : null} /><span className="font-medium">{s.v?.title}</span><span className="ml-auto text-xs text-muted">{formatDateTime(s.submitted_at)}</span></Link></li>))}
            </ul>
          )}
        </Panel>
        {(fb.data?.length ?? 0) > 0 && (
          <Panel className="lg:col-span-2">
            <PanelHeader title="Latest instructor feedback" />
            <ul className="divide-y divide-border text-sm">
              {fb.data!.map((r) => (<li key={r.id}><Link href={r.code_submission_id ? `/student/submissions/${r.code_submission_id}` : "/student/submissions"} className="block px-4 py-2.5 hover:bg-surface-2"><span className="font-medium">{r.s?.v?.title ?? "Quiz"}</span><p className="line-clamp-2 text-muted">{r.comments}</p></Link></li>))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}
