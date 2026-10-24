import Link from "next/link";
import { signOut } from "@/lib/auth/actions";
import { APP_NAME } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/auth/session";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { NavLinks, type NavItem } from "./nav-links";

export async function AppShell({
  user,
  nav,
  children,
}: {
  user: SessionUser;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: notes } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 sm:gap-4 border-b border-border bg-surface px-4">
        <Link href={user.role === "admin" ? "/admin" : "/student"} className="font-mono text-sm font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <span className="hidden rounded border border-border px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted sm:inline">{user.role}</span>
        <NavLinks items={nav} />
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell userId={user.id} initial={notes ?? []} />
          <ThemeToggle />
          <span className="ml-2 hidden text-sm text-muted sm:inline">{user.displayName}</span>
          <form action={signOut}>
            <button className="ml-1 whitespace-nowrap rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground">Sign out</button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
