import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCodingFor, cleanupCoding, deleteUser, makeUser, service, type TestUser } from "./helpers/supabase";

let admin: TestUser, student: TestUser;
let versionId = "";
let questionId = "";

const GOOD = `public static String maskCode(String code) { char[] c = code.toCharArray(); int l = 0, r = c.length - 1; while (l < r) { if (!Character.isLetter(c[l])) l++; else if (!Character.isLetter(c[r])) r--; else { char t = c[l]; c[l] = c[r]; c[r] = t; l++; r--; } } return new String(c); }`;
const BAD = `public static String maskCode(String code) { return code; }`;

async function submit(code: string, key: string) {
  const r = await service().from("code_submissions").insert({ student_id: student.id, question_version_id: versionId, source_code: code, idempotency_key: key, max_marks: 10 }).select("id").single();
  if (r.error) throw r.error;
  return r.data.id;
}

beforeAll(async () => {
  admin = await makeUser("admin", "pl-admin");
  student = await makeUser("student", "pl-student");
  ({ questionId, versionId } = await createCodingFor(admin));
});
afterAll(async () => {
  await cleanupCoding([questionId]);
  await service().from("notifications").delete().in("recipient_id", [admin.id, student.id]);
  await Promise.all([admin, student].map(deleteUser));
});

describe("submission pipeline (real DB, real sandbox)", () => {
  it("grades a correct solution as accepted, hides hidden-test data from the student row", async () => {
    vi.resetModules();
    process.env.RUNNER_PROVIDER = "docker";
    process.env.RUNNER_ALLOW_DOCKER = "1";
    const { processSubmission } = await import("@/lib/coding/submission");
    const id = await submit(GOOD, "k-good");
    await processSubmission(id);
    const s = await service().from("code_submissions").select("*").eq("id", id).single();
    expect(s.data).toMatchObject({ status: "completed", verdict: "accepted", passed_public: 2, total_public: 2, passed_hidden: 2, total_hidden: 2 });
    expect(Number(s.data!.score_pct)).toBe(100);
    expect(Number(s.data!.marks_awarded)).toBe(10);
    const hidden = (s.data!.results as { visibility: string; input?: string; expected?: string }[]).filter((r) => r.visibility === "hidden");
    expect(hidden).toHaveLength(2);
    expect(hidden.every((r) => r.input === undefined && r.expected === undefined)).toBe(true);
    const priv = await service().from("code_submission_private").select("detailed_results").eq("submission_id", id).single();
    expect(JSON.stringify(priv.data)).toContain("a-b-c#D"); // admin-only detail keeps the hidden input
    const n = await service().from("notifications").select("id").eq("recipient_id", admin.id).eq("reference_id", id);
    expect(n.data).toHaveLength(1);
  });

  it("grades a wrong solution as partial/wrong and never accepted", async () => {
    const { processSubmission } = await import("@/lib/coding/submission");
    const id = await submit(BAD, "k-bad");
    await processSubmission(id);
    const s = await service().from("code_submissions").select("verdict, score_pct, passed_public").eq("id", id).single();
    expect(s.data!.verdict).not.toBe("accepted");
    expect(Number(s.data!.score_pct)).toBeLessThan(100);
  });

  it("concurrent processing claims the job once", async () => {
    const { processSubmission } = await import("@/lib/coding/submission");
    const id = await submit(GOOD, "k-race");
    await Promise.all([processSubmission(id), processSubmission(id), processSubmission(id)]);
    const s = await service().from("code_submissions").select("attempts_count, status").eq("id", id).single();
    expect(s.data).toEqual({ attempts_count: 1, status: "completed" });
    const n = await service().from("notifications").select("id").eq("recipient_id", admin.id).eq("reference_id", id);
    expect(n.data).toHaveLength(1);
  });

  it("a dead runner yields system_error (not accepted) and the submission can be retried", async () => {
    vi.resetModules();
    process.env.RUNNER_PROVIDER = "judge0";
    process.env.JUDGE0_URL = "http://127.0.0.1:1"; // nothing listens here
    const { processSubmission, requeueSystemError } = await import("@/lib/coding/submission");
    const id = await submit(GOOD, "k-dead");
    await processSubmission(id);
    const s = await service().from("code_submissions").select("status, verdict, score_pct, error_message").eq("id", id).single();
    expect(s.data!.status).toBe("system_error");
    expect(s.data!.verdict).toBe("system_error");
    expect(s.data!.error_message).toMatch(/not evaluated/i);
    expect(JSON.stringify(s.data)).not.toContain("127.0.0.1"); // internals stay private

    // back online → retry grades the SAME immutable code
    vi.resetModules();
    process.env.RUNNER_PROVIDER = "docker";
    const again = await import("@/lib/coding/submission");
    expect(await again.requeueSystemError(id, student.id)).toBe(true);
    expect(await requeueSystemError(id, student.id)).toBe(false); // no longer in system_error
    await again.processSubmission(id);
    const fixed = await service().from("code_submissions").select("status, verdict, source_code").eq("id", id).single();
    expect(fixed.data).toMatchObject({ status: "completed", verdict: "accepted", source_code: GOOD });
  });
  it("offline grader: grades queued submissions, notifies the student only, and the submission stays immutable", async () => {
    vi.resetModules();
    process.env.RUNNER_PROVIDER = "docker";
    process.env.RUNNER_ALLOW_DOCKER = "1";
    const { gradePending } = await import("@/lib/coding/grade-pending");
    const good = await submit(GOOD, "k-offline-good");
    const bad = await submit(BAD, "k-offline-bad");
    const rows = await gradePending();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[good]).toMatchObject({ status: "completed", verdict: "accepted", scorePct: 100 });
    expect(byId[bad].verdict).not.toBe("accepted");
    // student is told, admin is not spammed a second time
    const sn = await service().from("notifications").select("type, link").eq("recipient_id", student.id).eq("reference_id", good);
    expect(sn.data).toEqual([{ type: "submission_graded", link: `/student/submissions/${good}` }]);
    const an = await service().from("notifications").select("id").eq("recipient_id", admin.id).eq("reference_id", good);
    expect(an.data).toHaveLength(0);
    // nothing left waiting; running again is a no-op
    expect(await gradePending()).toEqual([]);
    const code = await service().from("code_submissions").select("source_code").eq("id", good).single();
    expect(code.data!.source_code).toBe(GOOD);
  });
});
