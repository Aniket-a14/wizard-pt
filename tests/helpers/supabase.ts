import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

config({ path: ".env.local" });

export const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
export const SECRET = process.env.SUPABASE_SECRET_KEY!;

export type Db = SupabaseClient<Database>;

export const service = (): Db => createClient<Database>(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
export const anon = (): Db => createClient<Database>(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } });

export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: Db;
}

export async function makeUser(role: "admin" | "student", label: string): Promise<TestUser> {
  const admin = service();
  const email = `t-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const password = "Test-password-12345";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const p = await admin.from("profiles").insert({ id: data.user.id, display_name: label, role });
  if (p.error) throw p.error;
  const client = anon();
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return { id: data.user.id, email, password, client };
}

export async function deleteUser(u: TestUser) {
  const admin = service();
  await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
}

/** Create + fully configure a coding draft through the real RPC as `admin`. */
export async function createCodingDraft(admin: TestUser, opts: { hidden?: boolean; title?: string } = {}) {
  const payload = {
    title: opts.title ?? "Reverse Only the Letters",
    difficulty: "easy",
    topic: "Strings",
    tags: ["Strings"],
    statement_md: "Reverse only the letters.",
    examples: [{ input: "AB-12-CD", output: "DC-12-BA" }],
    marks: 10,
    config: {
      execution_mode: "function",
      grading_mode: "auto",
      function_signature: "public static String maskCode(String code)",
      editable_scope: "method",
      starter_code: "public static String maskCode(String code) {\n    return null;\n}\n",
    },
    secrets: { template_prefix: "public class Main {\n", template_suffix: "\n public static void main(String[] a){}\n}\n", reference_solution: "// ref" },
    tests: [
      { input: "AB-12-CD", expected_output: "DC-12-BA", visibility: "public" },
      ...(opts.hidden === false ? [] : [{ input: "SECRET-HIDDEN-INPUT", expected_output: "SECRET-HIDDEN-OUTPUT", visibility: "hidden" }]),
    ],
  };
  const r = await admin.client.rpc("save_coding_draft", { p_payload: payload });
  if (r.error) throw r.error;
  return r.data as unknown as { question_id: string; version_id: string };
}

/** A real, compilable, published maskCode problem (2 public + 2 hidden tests). */
export async function createCodingFor(admin: TestUser) {
  const { codingDraftSchema } = await import("@/lib/validation/question");
  const { prepareCoding } = await import("@/lib/coding/prepare");
  const draft = codingDraftSchema.parse({
    questionId: null,
    title: "PL maskCode",
    statement_md: "Reverse only the letters.",
    marks: 10,
    config: { execution_mode: "function", function_signature: "public static String maskCode(String code)", starter_code: "" },
    tests: [
      { input: "AB-12-CD", expected_output: "DC-12-BA", visibility: "public" },
      { input: "x-Y", expected_output: "Y-x", visibility: "public" },
      { input: "a-b-c#D", expected_output: "D-c-b#a", visibility: "hidden" },
      { input: "1234", expected_output: "1234", visibility: "hidden" },
    ],
  });
  const prep = prepareCoding(draft);
  if (!prep.ok) throw new Error(prep.error);
  const r = await admin.client.rpc("save_coding_draft", { p_payload: prep.payload as never });
  if (r.error) throw r.error;
  const { question_id, version_id } = r.data as unknown as { question_id: string; version_id: string };
  const p = await admin.client.rpc("publish_coding_question", { p_question_id: question_id });
  if (p.error) throw p.error;
  return { questionId: question_id, versionId: version_id };
}

export async function cleanupCoding(questionIds: string[]) {
  const s = service();
  const vs = await s.from("question_versions").select("id").in("question_id", questionIds);
  const vids = (vs.data ?? []).map((v) => v.id);
  if (vids.length) {
    await s.from("code_submissions").delete().in("question_version_id", vids);
    await s.from("code_runs").delete().in("question_version_id", vids);
  }
  await s.from("questions").update({ current_version_id: null, published_version_id: null }).in("id", questionIds);
  await s.from("questions").delete().in("id", questionIds);
}
