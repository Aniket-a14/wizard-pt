import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { listStudents } from "@/lib/students/provision";
import { formatDateTime } from "@/lib/utils";
import { AddStudent, StudentActions } from "./student-forms";

export const metadata = { title: "Students" };

export default async function Students() {
  await requireAdmin();
  const students = await listStudents(createAdminClient());
  const active = students.filter((s) => s.active).length;
  return (
    <>
      <PageHeader title="Students" description={`${active} active${students.length > active ? ` · ${students.length - active} deactivated` : ""}. Everything you publish goes to every active student; each student's work, scores and feedback stay private to them.`} />
      <div className="space-y-5">
        <AddStudent />
        <Panel className="overflow-x-auto">
          <PanelHeader title="All students" />
          {students.length === 0 ? <div className="p-4"><EmptyState title="No students yet">Add one above. They sign in with the email and password you set.</EmptyState></div> : (
            <table className="table-dense w-full text-sm">
              <thead><tr><th>Student</th><th>Email</th><th>Last sign-in</th><th>Coding</th><th>Quizzes</th><th>Status</th><th /></tr></thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className={s.active ? "" : "opacity-60"}>
                    <td className="font-medium">{s.name}</td>
                    <td className="text-muted">{s.email}</td>
                    <td className="text-muted">{s.lastSignInAt ? formatDateTime(s.lastSignInAt) : "never"}</td>
                    <td className="tabular-nums"><Link href={`/admin/submissions?student=${s.id}`} className="hover:text-accent hover:underline">{s.codeSubmissions}</Link>{s.accepted > 0 && <span className="ml-1 text-xs text-success">{s.accepted} accepted</span>}</td>
                    <td className="tabular-nums"><Link href={`/admin/submissions?tab=quiz&student=${s.id}`} className="hover:text-accent hover:underline">{s.quizAttempts}</Link>{s.avgQuizPct !== null && <span className="ml-1 text-xs text-muted">avg {Math.round(s.avgQuizPct)}%</span>}</td>
                    <td>{s.active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Deactivated</Badge>}</td>
                    <td className="text-right"><StudentActions id={s.id} name={s.name} active={s.active} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
