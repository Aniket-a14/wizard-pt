import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { getRunner } from "@/lib/runner";

/** Admin-only readiness probe for the database and the code runner. */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const checks: Record<string, { ok: boolean; detail: string }> = {};
  try {
    const { error } = await createAdminClient().from("profiles").select("id", { head: true, count: "exact" });
    checks.database = { ok: !error, detail: error ? "Database error" : "Connected" };
  } catch {
    checks.database = { ok: false, detail: "Database unreachable" };
  }
  try {
    checks.runner = await getRunner().health();
  } catch (e) {
    checks.runner = { ok: false, detail: (e as Error).message };
  }
  return NextResponse.json({ checks });
}
