import { AppShell } from "@/components/app-shell";
import { requireStudent } from "@/lib/auth/session";

const NAV = [
  { href: "/student", label: "Overview", exact: true },
  { href: "/student/assessments", label: "Assessments" },
  { href: "/student/submissions", label: "Submissions" },
  { href: "/student/progress", label: "Progress" },
  { href: "/student/settings", label: "Settings" },
];

export default async function StudentLayout({ children }: LayoutProps<"/student">) {
  const user = await requireStudent();
  return (
    <AppShell user={user} nav={NAV}>
      {children}
    </AppShell>
  );
}
