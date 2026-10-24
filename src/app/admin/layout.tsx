import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth/session";

const NAV = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/questions", label: "Questions" },
  { href: "/admin/import", label: "Import" },
  { href: "/admin/quizzes", label: "Quizzes" },
  { href: "/admin/submissions", label: "Submissions" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireAdmin();
  return (
    <AppShell user={user} nav={NAV}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6">{children}</div>
    </AppShell>
  );
}
