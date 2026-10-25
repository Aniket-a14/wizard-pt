import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { processSubmission, STALE_MS } from "./submission";

export interface GradedRow {
  id: string;
  title: string;
  verdict: string | null;
  scorePct: number | null;
  status: string;
}

/**
 * Grade every queued code submission (oldest first) with the configured runner — used by `pnpm grade`
 * when this site runs in external-runner mode. Each one is claimed atomically, so running it twice or
 * alongside the web app is safe. The student is notified; the admin already was when it was submitted.
 */
export async function gradePending(limit = 50): Promise<GradedRow[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("code_submissions")
    .select("id")
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${new Date(Date.now() - STALE_MS).toISOString()})`)
    .order("submitted_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const out: GradedRow[] = [];
  for (const { id } of data ?? []) {
    await processSubmission(id, { notifyStudent: true, notifyAdmin: false });
    const r = await db
      .from("code_submissions")
      .select("id, status, verdict, score_pct, v:question_versions!inner(title)")
      .eq("id", id)
      .single();
    if (r.data) out.push({ id, title: r.data.v?.title ?? "", verdict: r.data.verdict, scorePct: r.data.score_pct === null ? null : Number(r.data.score_pct), status: r.data.status });
  }
  return out;
}
