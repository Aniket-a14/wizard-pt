"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/utils";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Subscribes to the signed-in user's own notification rows (private: RLS filters the
 * realtime stream to recipient_id = auth.uid()). Notifications are hints — on every event
 * (and after every reconnect) we re-read the database and refresh the page data.
 */
export function NotificationBell({ userId, initial }: { userId: string; initial: NotificationRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>(initial);
  const [open, setOpen] = useState(false);
  const [supabase] = useState(() => createClient());
  const [seen] = useState(() => new Set(initial.map((n) => n.id)));

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) {
      setItems(data);
      data.forEach((n) => seen.add(n.id));
    }
  }, [supabase, seen]);

  useEffect(() => {
    let first = true;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as NotificationRow;
          if (seen.has(n.id)) return;
          seen.add(n.id);
          setItems((cur) => [n, ...cur].slice(0, 20));
          toast(n.title, { description: n.body ?? undefined, action: n.link ? { label: "Open", onClick: () => router.push(n.link!) } : undefined });
          router.refresh();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // After (re)connecting, recover anything missed while offline.
          if (!first) {
            void refetch();
            router.refresh();
          }
          first = false;
        }
      });
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId, router, refetch, seen]);

  const unread = items.filter((n) => !n.read_at).length;

  async function markAllRead() {
    const now = new Date().toISOString();
    setItems((cur) => cur.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread > 0) void markAllRead();
        }}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-lg border border-border-strong bg-surface shadow-lg">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted">Notifications</div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing yet</li>}
            {items.map((n) => (
              <li key={n.id} className="border-b border-border last:border-0">
                <Link
                  href={n.link ?? "#"}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 hover:bg-surface-2"
                >
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.body && <div className="text-xs text-muted">{n.body}</div>}
                  <div className="mt-0.5 text-[11px] text-muted">{timeAgo(n.created_at)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
