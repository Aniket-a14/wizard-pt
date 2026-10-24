import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Quizzes" };

export default async function QuizList() {
  const supabase = await createClient();
  const { data } = await supabase.from("assessments").select("id, seq, title, status, published_at, updated_at, settings, assessment_questions(marks), attempts:assessment_attempts(id, status)").order("updated_at", { ascending: false });
  return (
    <>
      <PageHeader title="Quizzes" description="Group MCQs into a quiz, set timer/marking/visibility, then publish." actions={<Link href="/admin/quizzes/new" className={buttonVariants({ variant: "primary" })}>New quiz</Link>} />
      {(data?.length ?? 0) === 0 ? <EmptyState title="No quizzes yet">Create MCQs (or import them from a PDF), then build a quiz from them.</EmptyState> : (
        <Panel className="overflow-x-auto">
          <table className="table-dense w-full text-sm">
            <thead><tr><th>Quiz</th><th>Status</th><th>Questions</th><th>Marks</th><th>Attempts</th><th>Updated</th></tr></thead>
            <tbody>
              {data!.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/admin/quizzes/${a.id}`} className="font-medium hover:text-accent hover:underline">{a.title}</Link></td>
                  <td><Badge tone={a.status === "published" ? "success" : a.status === "archived" ? "warning" : "neutral"}>{a.status}</Badge></td>
                  <td className="tabular-nums">{a.assessment_questions.length}</td>
                  <td className="tabular-nums">{a.assessment_questions.reduce((s, q) => s + Number(q.marks), 0)}</td>
                  <td className="tabular-nums text-muted">{a.attempts.filter((t) => t.status === "submitted").length} submitted</td>
                  <td className="text-muted">{formatDateTime(a.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
