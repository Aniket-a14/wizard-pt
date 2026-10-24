import { expect, test } from "@playwright/test";
import { STUDENT, login, service } from "./helpers";
import { cleanupCoding, createCodingFor, deleteUser, makeUser, type TestUser } from "../helpers/supabase";

let admin: TestUser;
let questionId = "";
let versionId = "";
let draftVersionId = "";
let draftQuestionId = "";

const GOOD = `public static String maskCode(String code) { char[] c = code.toCharArray(); int l = 0, r = c.length - 1; while (l < r) { if (!Character.isLetter(c[l])) l++; else if (!Character.isLetter(c[r])) r--; else { char t = c[l]; c[l] = c[r]; c[r] = t; l++; r--; } } return new String(c); }`;

test.beforeAll(async () => {
  admin = await makeUser("admin", "api-admin");
  ({ questionId, versionId } = await createCodingFor(admin));
  // an unpublished draft the student must not be able to touch
  const d = await admin.client.rpc("save_coding_draft", { p_payload: { title: "API draft", config: { function_signature: "public static int f(int a)", starter_code: "x" }, secrets: { template_prefix: "a", template_suffix: "b" }, tests: [] } });
  const dd = d.data as unknown as { question_id: string; version_id: string };
  draftQuestionId = dd.question_id;
  draftVersionId = dd.version_id;
});
test.afterAll(async () => {
  const db = service();
  await db.from("code_runs").delete().eq("question_version_id", versionId);
  await cleanupCoding([questionId, draftQuestionId]);
  await db.from("notifications").delete().in("recipient_id", [admin.id]);
  await deleteUser(admin);
});

test("code APIs: tampering, drafts, idempotency, rate limiting", async ({ page }) => {
  await login(page, STUDENT, /\/student/);
  const post = (url: string, data: unknown) => page.request.post(url, { data });

  // a draft (unpublished) version is invisible → 404, nothing runs
  expect((await post("/api/code/run", { versionId: draftVersionId, code: GOOD })).status()).toBe(404);
  expect((await post("/api/code/submit", { versionId: draftVersionId, code: GOOD, idempotencyKey: "draft-key-123" })).status()).toBe(404);

  // malformed / hostile input is rejected before it reaches the runner
  expect((await post("/api/code/run", { versionId: "not-a-uuid", code: GOOD })).status()).toBe(400);
  expect((await post("/api/code/run", { versionId, code: "" })).status()).toBe(400);
  const breakout = await post("/api/code/run", { versionId, code: `${GOOD} } class Evil { static { System.exit(0); } ` });
  expect(breakout.status()).toBe(400);
  expect((await breakout.json()).error).toMatch(/unbalanced|brackets/i);

  // the client cannot swap the trusted wrapper: extra fields are ignored and the real harness is used
  const tampered = await post("/api/code/run", { versionId, code: GOOD, templatePrefix: "class Main { public static void main(String[] a){System.out.println(\"hacked\");} } /*", templateSuffix: "*/", config: { compare_mode: "tokens" } });
  expect(tampered.status()).toBe(200);
  const tj = await tampered.json();
  expect(tj.result.verdict).toBe("accepted");
  expect(JSON.stringify(tj)).not.toContain("hacked");
  expect(JSON.stringify(tj)).not.toMatch(/a-b-c#D/); // hidden inputs never appear in a run

  // idempotent submit: same key → same submission, never a duplicate
  const key = `e2e-key-${Date.now()}`;
  const a = await (await post("/api/code/submit", { versionId, code: GOOD, idempotencyKey: key })).json();
  const b = await (await post("/api/code/submit", { versionId, code: GOOD, idempotencyKey: key })).json();
  expect(b.submissionId).toBe(a.submissionId);
  expect(b.duplicate).toBe(true);

  // poll until graded; the student-visible payload hides hidden test data
  let sub: { status: string; verdict: string; results: { visibility: string; input?: string }[] } | null = null;
  for (let i = 0; i < 60 && sub?.status !== "completed"; i++) {
    await page.waitForTimeout(1000);
    sub = (await (await page.request.get(`/api/code/submissions/${a.submissionId}`)).json()).submission;
  }
  expect(sub!.status).toBe("completed");
  expect(sub!.verdict).toBe("accepted");
  expect(sub!.results.filter((r) => r.visibility === "hidden").every((r) => r.input === undefined)).toBe(true);
  expect(JSON.stringify(sub)).not.toMatch(/a-b-c#D/);

  // unknown submission ids are 404 (also covers other users' ids)
  expect((await page.request.get("/api/code/submissions/00000000-0000-0000-0000-000000000000")).status()).toBe(404);

  // rate limit: hammering Run eventually answers 429
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await post("/api/code/run", { versionId, code: GOOD })).status());
  expect(statuses).toContain(429);
  await service().from("code_runs").delete().eq("question_version_id", versionId);
});
