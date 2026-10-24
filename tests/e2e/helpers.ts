import { expect, type Page } from "@playwright/test";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

export const ADMIN = { email: process.env.ADMIN_EMAIL!, password: process.env.ADMIN_PASSWORD! };
export const STUDENT = { email: process.env.STUDENT_EMAIL!, password: process.env.STUDENT_PASSWORD! };

export async function login(page: Page, who: { email: string; password: string }, expectPath: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(expectPath);
}

/** Replace the contents of the first Monaco editor inside `scope` using Monaco's own API (like a paste). */
export async function setMonaco(page: Page, scope: ReturnType<Page["locator"]>, text: string) {
  const ed = scope.locator(".monaco-editor").first();
  await expect(ed).toBeVisible({ timeout: 60_000 });
  await ed.evaluate((el, value) => {
    const m = (window as unknown as { monaco: { editor: { getEditors(): { getDomNode(): HTMLElement | null; setValue(v: string): void }[] } } }).monaco;
    const editor = m.editor.getEditors().find((e) => e.getDomNode() && el.closest(".monaco-editor") === e.getDomNode()!.querySelector(".monaco-editor") || el.contains(e.getDomNode()) || e.getDomNode()?.contains(el));
    if (!editor) throw new Error("Monaco editor instance not found");
    editor.setValue(value);
  }, text);
  void page;
}

export function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
}

/** Remove anything a previous e2e run left behind (titles contain "E2E"). */
export async function cleanupE2E() {
  const db = service();
  const { data: versions } = await db.from("question_versions").select("id, question_id").ilike("title", "%E2E%");
  const vids = (versions ?? []).map((v) => v.id);
  const qids = [...new Set((versions ?? []).map((v) => v.question_id))];
  if (vids.length) {
    const subs = await db.from("code_submissions").select("id").in("question_version_id", vids);
    const sids = (subs.data ?? []).map((s) => s.id);
    if (sids.length) await db.from("reviews").delete().in("code_submission_id", sids);
    await db.from("code_submissions").delete().in("question_version_id", vids);
    await db.from("code_runs").delete().in("question_version_id", vids);
    const aqs = await db.from("assessment_questions").select("assessment_id").in("question_version_id", vids);
    const aids = [...new Set((aqs.data ?? []).map((a) => a.assessment_id))];
    if (aids.length) {
      const att = await db.from("assessment_attempts").select("id").in("assessment_id", aids);
      const attIds = (att.data ?? []).map((a) => a.id);
      if (attIds.length) await db.from("reviews").delete().in("attempt_id", attIds);
      await db.from("assessment_attempts").delete().in("assessment_id", aids);
      await db.from("assessment_questions").delete().in("assessment_id", aids);
      await db.from("assessments").delete().in("id", aids);
    }
  }
  const { data: quizzes } = await db.from("assessments").select("id").ilike("title", "%E2E%");
  for (const q of quizzes ?? []) {
    const att = await db.from("assessment_attempts").select("id").eq("assessment_id", q.id);
    const attIds = (att.data ?? []).map((a) => a.id);
    if (attIds.length) await db.from("reviews").delete().in("attempt_id", attIds);
    await db.from("assessment_attempts").delete().eq("assessment_id", q.id);
    await db.from("assessment_questions").delete().eq("assessment_id", q.id);
    await db.from("assessments").delete().eq("id", q.id);
  }
  // Questions created through the PDF fixture import.
  const imps = await db.from("imports").select("id").eq("file_name", "mcq-text.pdf");
  const impIds = (imps.data ?? []).map((i) => i.id);
  if (impIds.length) {
    const fromImports = await db.from("questions").select("id").in("import_id", impIds);
    for (const q of fromImports.data ?? []) if (!qids.includes(q.id)) qids.push(q.id);
  }
  if (qids.length) {
    await db.from("questions").update({ current_version_id: null, published_version_id: null }).in("id", qids);
    await db.from("questions").delete().in("id", qids);
  }
  if (impIds.length) await db.from("imports").delete().in("id", impIds);
  await db.from("notifications").delete().ilike("title", "%E2E%");
}
