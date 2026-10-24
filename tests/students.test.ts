import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStudent, generatePassword, listStudents, passwordProblem, resetStudentPassword, setStudentActive, StudentError } from "@/lib/students/provision";
import { anon, cleanupCoding, createCodingFor, deleteUser, makeUser, service, type Db, type TestUser } from "./helpers/supabase";

const db = service();
let admin: TestUser;
const made: string[] = [];
let questionId: string;
let versionId: string;

async function signIn(email: string, password: string): Promise<Db> {
  const c = anon();
  const r = await c.auth.signInWithPassword({ email, password });
  if (r.error) throw r.error;
  return c;
}
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

beforeAll(async () => {
  admin = await makeUser("admin", "many-admin");
});

afterAll(async () => {
  if (questionId) await cleanupCoding([questionId]);
  await db.from("notifications").delete().in("recipient_id", made);
  for (const id of made) await db.auth.admin.deleteUser(id).catch(() => undefined);
  await deleteUser(admin);
});

describe("password helpers", () => {
  it("generated passwords always satisfy the policy", () => {
    for (let i = 0; i < 200; i++) expect(passwordProblem(generatePassword())).toBeNull();
    expect(passwordProblem("short1A")).toMatch(/10/);
    expect(passwordProblem("alllowercase123")).toMatch(/upper/);
  });
});

describe("one admin, many students", () => {
  const s: { id: string; email: string; password: string; client?: Db }[] = [];

  it("provisions several students, each able to sign in", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await createStudent(db, { name: `Many ${i}`, email: `many-${i}-${tag()}@test.local` });
      made.push(r.id);
      s.push(r);
      s[i].client = await signIn(r.email, r.password);
    }
    const rows = await listStudents(db);
    for (const x of s) {
      const row = rows.find((r) => r.id === x.id)!;
      expect(row).toMatchObject({ email: x.email, active: true, codeSubmissions: 0 });
    }
  });

  it("rejects a duplicate email and a weak password, leaving no half-made account", async () => {
    await expect(createStudent(db, { name: "Dup", email: s[0].email })).rejects.toThrow(/already exists/);
    const email = `weak-${tag()}@test.local`;
    await expect(createStudent(db, { name: "Weak", email, password: "weak" })).rejects.toBeInstanceOf(StudentError);
    const l = await db.auth.admin.listUsers({ perPage: 1000 });
    expect(l.data.users.some((u) => u.email === email)).toBe(false);
  });

  it("a published problem reaches every student, each with their own notification", async () => {
    ({ questionId, versionId } = await createCodingFor(admin));
    for (const x of s) {
      const vis = await x.client!.from("question_versions").select("id").eq("id", versionId);
      expect(vis.data?.length).toBe(1);
      const n = await x.client!.from("notifications").select("recipient_id").eq("reference_id", questionId);
      expect(n.data?.length).toBe(1);
      expect(n.data![0].recipient_id).toBe(x.id);
    }
  });

  it("students cannot see each other's profile or notifications", async () => {
    const p = await s[0].client!.from("profiles").select("id");
    expect(p.data?.map((r) => r.id)).toEqual([s[0].id]);
    const n = await s[0].client!.from("notifications").select("recipient_id");
    expect(new Set(n.data?.map((r) => r.recipient_id))).toEqual(new Set([s[0].id]));
  });

  it("a student cannot reactivate themselves or change their role", async () => {
    const r = await s[1].client!.from("profiles").update({ active: false } as never).eq("id", s[1].id);
    expect(r.error).not.toBeNull();
    const role = await s[1].client!.from("profiles").update({ role: "admin" } as never).eq("id", s[1].id);
    expect(role.error).not.toBeNull();
  });

  it("deactivating one student cuts their access at the database level and affects nobody else", async () => {
    await setStudentActive(db, s[1].id, false);
    // their already-issued session no longer sees any student content ...
    const gone = await s[1].client!.from("question_versions").select("id").eq("id", versionId);
    expect(gone.data).toEqual([]);
    // ... and they cannot sign in again
    const again = await anon().auth.signInWithPassword({ email: s[1].email, password: s[1].password });
    expect(again.error).not.toBeNull();
    // the others are untouched
    for (const i of [0, 2]) {
      const vis = await s[i].client!.from("question_versions").select("id").eq("id", versionId);
      expect(vis.data?.length).toBe(1);
    }
    expect((await listStudents(db)).find((r) => r.id === s[1].id)?.active).toBe(false);
  });

  it("reactivating restores access", async () => {
    await setStudentActive(db, s[1].id, true);
    const c = await signIn(s[1].email, s[1].password);
    const vis = await c.from("question_versions").select("id").eq("id", versionId);
    expect(vis.data?.length).toBe(1);
  });

  it("resetting a password replaces the old one", async () => {
    const { password } = await resetStudentPassword(db, s[2].id);
    expect((await anon().auth.signInWithPassword({ email: s[2].email, password: s[2].password })).error).not.toBeNull();
    expect((await anon().auth.signInWithPassword({ email: s[2].email, password })).error).toBeNull();
  });

  it("the student-management helpers never touch the admin account", async () => {
    await expect(setStudentActive(db, admin.id, false)).rejects.toThrow(/does not exist/);
    await expect(resetStudentPassword(db, admin.id)).rejects.toThrow(/does not exist/);
  });
});
