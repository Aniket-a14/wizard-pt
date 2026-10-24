/**
 * Student account provisioning, shared by the admin "Students" page and `pnpm student:add`.
 * Takes a service-role client: callers must already have authorised the admin. Never import this from
 * client code. Public sign-up is disabled in Supabase, so this is the only way a student account exists.
 */
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export class StudentError extends Error {}

const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGIT = "23456789";

/** A readable random password that satisfies the project's policy (10+ chars, lower + upper + digit). */
export function generatePassword(length = 14): string {
  const all = LOWER + UPPER + DIGIT;
  const pick = (s: string) => s[randomInt(s.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return "Use lower-case, upper-case letters and digits.";
  return null;
}

async function requireStudent(db: Db, id: string) {
  const { data } = await db.from("profiles").select("id, role").eq("id", id).maybeSingle();
  if (!data || data.role !== "student") throw new StudentError("That student does not exist.");
}

export async function createStudent(db: Db, input: { email: string; name: string; password?: string }) {
  const email = input.email.trim().toLowerCase();
  const password = input.password || generatePassword();
  const bad = passwordProblem(password);
  if (bad) throw new StudentError(bad);
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: input.name } });
  if (created.error) {
    if (/already|registered|exists/i.test(created.error.message)) throw new StudentError("An account with that email already exists.");
    throw new StudentError(created.error.message);
  }
  const id = created.data.user.id;
  const { error } = await db.from("profiles").upsert({ id, display_name: input.name, role: "student", active: true });
  if (error) {
    await db.auth.admin.deleteUser(id); // don't leave a login with no profile
    throw error;
  }
  return { id, email, password };
}

export async function resetStudentPassword(db: Db, id: string, password?: string) {
  await requireStudent(db, id);
  const next = password || generatePassword();
  const bad = passwordProblem(next);
  if (bad) throw new StudentError(bad);
  const { error } = await db.auth.admin.updateUserById(id, { password: next });
  if (error) throw new StudentError(error.message);
  return { password: next };
}

/** Deactivate = RLS stops treating them as a student and the auth server refuses new sign-ins / refreshes. History is kept. */
export async function setStudentActive(db: Db, id: string, active: boolean) {
  await requireStudent(db, id);
  const { error } = await db.from("profiles").update({ active }).eq("id", id);
  if (error) throw error;
  const ban = await db.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
  if (ban.error) throw new StudentError(ban.error.message);
}

export interface StudentRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  joinedAt: string;
  lastSignInAt: string | null;
  codeSubmissions: number;
  accepted: number;
  quizAttempts: number;
  avgQuizPct: number | null;
}

/** Every student with their email (auth) and activity totals. */
export async function listStudents(db: Db): Promise<StudentRow[]> {
  const profiles = await db.from("profiles").select("id, display_name, active, created_at").eq("role", "student").order("created_at");
  if (profiles.error) throw profiles.error;

  const users = new Map<string, { email: string; last: string | null }>();
  for (let page = 1; ; page++) {
    const l = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (l.error) throw l.error;
    for (const u of l.data.users) users.set(u.id, { email: u.email ?? "", last: u.last_sign_in_at ?? null });
    if (l.data.users.length < 200) break;
  }

  const [subs, attempts] = await Promise.all([
    db.from("code_submissions").select("student_id, status, verdict"),
    db.from("assessment_attempts").select("student_id, score, max_score").eq("status", "submitted"),
  ]);
  if (subs.error) throw subs.error;
  if (attempts.error) throw attempts.error;

  return (profiles.data ?? []).map((p) => {
    const mine = (subs.data ?? []).filter((s) => s.student_id === p.id && s.status === "completed");
    const qs = (attempts.data ?? []).filter((a) => a.student_id === p.id && a.max_score && Number(a.max_score) > 0);
    return {
      id: p.id,
      name: p.display_name,
      email: users.get(p.id)?.email ?? "",
      active: p.active,
      joinedAt: p.created_at,
      lastSignInAt: users.get(p.id)?.last ?? null,
      codeSubmissions: mine.length,
      accepted: mine.filter((s) => s.verdict === "accepted").length,
      quizAttempts: qs.length,
      avgQuizPct: qs.length ? qs.reduce((n, a) => n + (Number(a.score) / Number(a.max_score)) * 100, 0) / qs.length : null,
    };
  });
}
