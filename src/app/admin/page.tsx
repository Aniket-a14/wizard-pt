import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PanelHeader, Stat } from "@/components/ui/panel";
import { getAdminAnalytics } from "@/lib/admin/analytics";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function AdminHome() {
  const a = await getAdminAnalytics();
  const completed = a.submittedCoding + a.submittedQuizzes;
  return (
    <>
      <PageHeader title="Overview" />
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/admin/questions/new/coding" className={buttonVariants({ variant: "primary", size: "lg" })}>Create coding problem</Link>
        <Link href="/admin/quizzes/new" className={buttonVariants({ size: "lg" })}>Create MCQ / quiz</Link>
        <Link href="/admin/import?mode=pdf" className={buttonVariants({ size: "lg" })}>Upload PDF</Link>
        <Link href="/admin/import" className={buttonVariants({ size: "lg" })}>Paste questions</Link>
        <Link href="/admin/submissions" className={buttonVariants({ size: "lg" })}>Review submissions{a.pendingReviews > 0 && <span className="ml-1 rounded-full bg-warning-soft px-1.5 text-xs text-warning">{a.pendingReviews}</span>}</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Coding questions" value={a.codingQuestions.total} hint={`${a.codingQuestions.published} published · ${a.codingQuestions.draft} draft`} />
        <Stat label="MCQ questions" value={a.mcqQuestions.total} hint={`${a.mcqQuestions.published} in published quizzes`} />
        <Stat label="Published assessments" value={a.codingQuestions.published + a.quizzes.published} hint={`${a.codingQuestions.published} problems · ${a.quizzes.published} quizzes`} />
        <Stat label="Draft assessments" value={a.codingQuestions.draft + a.quizzes.draft} hint={`${a.codingQuestions.draft} problems · ${a.quizzes.draft} quizzes`} />
        <Stat label="Pending reviews" value={a.pendingReviews} />
        <Stat label="Completed assessments" value={completed} hint={`${a.submittedCoding} coding · ${a.submittedQuizzes} quiz`} />
        <Stat label="Coding acceptance" value={a.acceptanceRate === null ? "—" : `${Math.round(a.acceptanceRate)}%`} hint={`${a.acceptedProblems} problems solved`} />
        <Stat label="Average quiz score" value={a.avgQuizPct === null ? "—" : `${Math.round(a.avgQuizPct)}%`} hint={a.mcqAccuracy === null ? undefined : `MCQ accuracy ${Math.round(a.mcqAccuracy)}%`} />
      </div>
      <Panel className="mt-6">
        <PanelHeader title="Recent activity" actions={<Link href="/admin/submissions" className="text-xs text-accent underline">All submissions</Link>} />
        {a.recent.length === 0 ? <div className="p-4"><EmptyState title="No submissions yet">When a student submits work it appears here (and as a notification).</EmptyState></div> : (
          <ul className="divide-y divide-border text-sm">
            {a.recent.map((r) => (
              <li key={`${r.kind}-${r.id}`}><Link href={`/admin/submissions/${r.kind}/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"><Badge>{r.kind === "code" ? "Code" : "Quiz"}</Badge><span className="font-medium">{r.title}</span><span className="text-muted capitalize">{r.detail}</span><span className="ml-auto text-xs text-muted">{formatDateTime(r.at)}</span></Link></li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
