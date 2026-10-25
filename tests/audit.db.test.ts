import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupCoding, createCodingFor, deleteUser, makeUser, service, type TestUser } from "./helpers/supabase";
import { finalizeAttempt, saveAnswer, startOrResumeAttempt } from "@/lib/quiz/server";
import { setStudentActive } from "@/lib/students/provision";
import * as evaluation from "@/lib/coding/evaluate";
import { processSubmission } from "@/lib/coding/submission";

const db = service();
let admin: TestUser, student: TestUser;
let questionId = "", versionId = "", quizId = "", mcqId = "", mcqVersion = "", correct = "";
const batchIds: string[] = [];
const importedQuestions: string[] = [];
const imagePath = `audit-${randomUUID()}.png`;

async function enqueue(key = randomUUID()) {
  const r = await db.rpc("enqueue_code_submission", { p_student_id: student.id, p_version_id: versionId,
    p_code: "public static String maskCode(String code) { return code; }", p_language: "java", p_key: key, p_max_marks: 10 });
  if (r.error) throw r.error;
  return r.data as { id: string; duplicate: boolean };
}
const report = (systemError: string | null = null): evaluation.EvalOutput => ({
  compileOutput: null, full: [], student: [], systemError, execTimeMs: 1, memoryKb: 1,
  summary: { verdict: "accepted", scorePct: 100, passedPublic: 2, totalPublic: 2, passedHidden: 2, totalHidden: 2 },
});

beforeAll(async () => {
  admin = await makeUser("admin", "audit-admin");
  student = await makeUser("student", "audit-student");
  ({ questionId, versionId } = await createCodingFor(admin));
  const mcq = await admin.client.rpc("save_mcq_draft", { p_payload: { title: "Audit MCQ", statement_md: "Choose a",
    image_path: imagePath, options: [{ text: "a", correct: true }, { text: "b", correct: false }] } });
  if (mcq.error) throw mcq.error;
  ({ question_id: mcqId, version_id: mcqVersion } = mcq.data as { question_id: string; version_id: string });
  const options = await db.from("mcq_options").select("id").eq("question_version_id", mcqVersion).order("display_order");
  correct = options.data![0].id;
  const uploaded = await admin.client.storage.from("question-assets").upload(imagePath,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64"), { contentType: "image/png" });
  if (uploaded.error) throw uploaded.error;
  const quiz = await admin.client.rpc("save_quiz_draft", { p_payload: { title: "Audit quiz",
    settings: { max_attempts: 20 }, questions: [{ question_id: mcqId, marks: 1 }] } });
  if (quiz.error) throw quiz.error;
  quizId = quiz.data;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.from("profiles").update({ active: true }).eq("id", student.id);
  await db.from("assessment_attempts").delete().eq("assessment_id", quizId);
  await db.from("assessments").delete().eq("id", quizId);
  await db.from("import_batches").delete().in("id", batchIds);
  await db.storage.from("question-assets").remove([imagePath]);
  await cleanupCoding([questionId, mcqId, ...importedQuestions]);
  await db.from("notifications").delete().in("recipient_id", [admin.id, student.id]);
  await Promise.all([admin, student].map(deleteUser));
});

describe("audit: storage and active-user policies", () => {
  it("hides draft images, including bucket listings, then exposes published images", async () => {
    expect((await student.client.storage.from("question-assets").download(imagePath)).error).not.toBeNull();
    expect((await student.client.storage.from("question-assets").list("", { search: imagePath })).data).toEqual([]);
    expect((await admin.client.storage.from("question-assets").download(imagePath)).error).toBeNull();
    const pub = await admin.client.rpc("publish_assessment", { p_assessment_id: quizId });
    expect(pub.error).toBeNull();
    expect((await student.client.storage.from("question-assets").download(imagePath)).error).toBeNull();
  });
});

describe("audit: quiz atomicity", () => {
  it("rejects a stale answer snapshot, then grades the latest saved answer", async () => {
    const id = await startOrResumeAttempt(quizId, student.id);
    await saveAnswer({ attemptId: id, studentId: student.id, versionId: mcqVersion, selected: [correct], marked: false });
    const stale = await db.rpc("commit_quiz_attempt", { p_attempt_id: id, p_student_id: student.id, p_answers: {},
      p_grades: [{ question_version_id: mcqVersion, is_correct: false, awarded_marks: 0, max_marks: 1 }],
      p_score: 0, p_max_score: 1, p_auto: false });
    expect(stale.error).toBeNull(); expect(stale.data).toBe(false);
    await finalizeAttempt(id, student.id);
    expect((await db.from("assessment_attempts").select("status, score").eq("id", id).single()).data).toEqual({ status: "submitted", score: 1 });
  });

  it("rolls back finalization when grade persistence fails", async () => {
    const id = await startOrResumeAttempt(quizId, student.id);
    const failed = await db.rpc("commit_quiz_attempt", { p_attempt_id: id, p_student_id: student.id, p_answers: {},
      p_grades: [{ question_version_id: mcqVersion, is_correct: true, awarded_marks: 1e12, max_marks: 1 }],
      p_score: 1, p_max_score: 1, p_auto: false });
    expect(failed.error?.code).toBe("22003");
    expect((await db.from("assessment_attempts").select("status").eq("id", id).single()).data?.status).toBe("in_progress");
    expect((await db.from("attempt_grades").select("*").eq("attempt_id", id)).data).toEqual([]);
    await finalizeAttempt(id, student.id);
  });

  it("serializes simultaneous answer saves and submissions, and never changes submitted answers", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await startOrResumeAttempt(quizId, student.id);
      const save = saveAnswer({ attemptId: id, studentId: student.id, versionId: mcqVersion, selected: [correct], marked: false });
      await Promise.allSettled([save, finalizeAttempt(id, student.id)]);
      await finalizeAttempt(id, student.id);
      const answers = await db.from("attempt_answers").select("selected_option_ids").eq("attempt_id", id);
      const grade = await db.from("attempt_grades").select("is_correct").eq("attempt_id", id).single();
      expect(grade.data?.is_correct).toBe(answers.data?.[0]?.selected_option_ids.includes(correct) ?? false);
      await expect(saveAnswer({ attemptId: id, studentId: student.id, versionId: mcqVersion, selected: [], marked: false })).rejects.toThrow(/already been submitted/);
    }
  });

  it("does not expose service-only write RPCs to signed-in students", async () => {
    const r = await student.client.rpc("save_quiz_answer", { p_attempt_id: randomUUID(), p_student_id: student.id,
      p_version_id: mcqVersion, p_selected: [], p_marked: false });
    expect(r.error?.code).toBe("42501");
  });
});

describe("audit: execution admission and ownership", () => {
  it("admits at most eight simultaneous runs", async () => {
    const runs = await Promise.all(Array.from({ length: 20 }, () => db.rpc("reserve_code_run", {
      p_student_id: student.id, p_version_id: versionId, p_code: "source" })));
    expect(runs.filter((r) => !r.error)).toHaveLength(8);
    expect(runs.filter((r) => r.error?.message === "Run rate limit exceeded.")).toHaveLength(12);
  });

  it("collapses identical concurrent submissions and rejects key reuse with different code", async () => {
    const key = randomUUID();
    const rows = await Promise.all(Array.from({ length: 8 }, () => enqueue(key)));
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(rows.filter((r) => !r.duplicate)).toHaveLength(1);
    const bad = await db.rpc("enqueue_code_submission", { p_student_id: student.id, p_version_id: versionId,
      p_code: "revised", p_language: "java", p_key: key, p_max_marks: 10 });
    expect(bad.error?.message).toMatch(/different submission/);
  });

  it("admits at most twelve simultaneous submissions", async () => {
    await db.from("code_submissions").delete().eq("student_id", student.id);
    const rows = await Promise.all(Array.from({ length: 20 }, () => enqueue().then(() => true).catch(() => false)));
    expect(rows.filter(Boolean)).toHaveLength(12);
    await db.from("code_submissions").delete().eq("student_id", student.id);
  });

  it("a superseded worker cannot overwrite a newer Accepted result or its details", async () => {
    const { id } = await enqueue();
    const resolves: ((value: evaluation.EvalOutput) => void)[] = [];
    vi.spyOn(evaluation, "evaluate").mockImplementation(() => new Promise((resolve) => resolves.push(resolve)));
    const first = processSubmission(id);
    await vi.waitFor(() => expect(resolves).toHaveLength(1));
    await db.from("code_submissions").update({ claimed_at: new Date(Date.now() - 100_000).toISOString() }).eq("id", id);
    const second = processSubmission(id);
    await vi.waitFor(() => expect(resolves).toHaveLength(2));
    resolves[1](report()); await second;
    resolves[0](report("old worker failed")); await first;
    expect((await db.from("code_submissions").select("status, verdict, attempts_count").eq("id", id).single()).data)
      .toEqual({ status: "completed", verdict: "accepted", attempts_count: 2 });
    expect((await db.from("code_submission_private").select("detailed_results").eq("submission_id", id).single()).data?.detailed_results).toEqual([]);
    expect((await db.from("notifications").select("id").eq("reference_id", id).eq("recipient_id", admin.id)).data).toHaveLength(1);
  });

  it("offline grading recovers a stale running submission", async () => {
    const { id } = await enqueue();
    await db.from("code_submissions").update({ status: "running", claimed_at: new Date(Date.now() - 100_000).toISOString(), claim_token: randomUUID() }).eq("id", id);
    vi.spyOn(evaluation, "evaluate").mockResolvedValue(report());
    const { gradePending } = await import("@/lib/coding/grade-pending");
    expect((await gradePending()).find((r) => r.id === id)).toMatchObject({ status: "completed", verdict: "accepted" });
  });
});

describe("audit: feedback revisions and imports", () => {
  it("keeps a published review unchanged until its private revision is republished", async () => {
    const { id } = await enqueue();
    const initial = { code_submission_id: id, status: "reviewed", comments: "published", marks: 5, max_marks: 10 };
    const saved = await admin.client.rpc("save_review", { p_payload: initial, p_publish: true });
    expect(saved.error).toBeNull();
    const draft = await admin.client.rpc("save_review", { p_payload: { ...initial, comments: "private revision", marks: 7 }, p_publish: false });
    expect(draft.error).toBeNull(); expect(draft.data).toMatchObject({ hasDraft: true });
    expect((await student.client.from("reviews").select("comments, marks").eq("code_submission_id", id).single()).data).toEqual({ comments: "published", marks: 5 });
    expect((await student.client.from("review_drafts").select("*")).data).toEqual([]);
    const republished = await admin.client.rpc("save_review", { p_payload: { ...initial, comments: "private revision", marks: 7 }, p_publish: true });
    expect(republished.error).toBeNull();
    expect((await student.client.from("reviews").select("comments, marks").eq("code_submission_id", id).single()).data).toEqual({ comments: "private revision", marks: 7 });
  });

  it("rolls back failed imports and reuses successful batch results after retries", async () => {
    const id = randomUUID(); batchIds.push(id);
    const item = { type: "mcq", payload: { title: `Audit import ${id}`, options: [{ text: "a", correct: true }, { text: "b", correct: false }] } };
    const bad = await admin.client.rpc("commit_import_batch", { p_batch_id: id, p_items: [item, { type: "bad", payload: {} }] });
    expect(bad.error).not.toBeNull();
    expect((await db.from("question_versions").select("id").eq("title", item.payload.title)).data).toEqual([]);
    const results = await Promise.all(Array.from({ length: 4 }, () => admin.client.rpc("commit_import_batch", { p_batch_id: id, p_items: [item] })));
    for (const r of results) expect(r.error).toBeNull();
    const created = results[0].data as { questionId: string }[];
    importedQuestions.push(created[0].questionId);
    for (const r of results) expect(r.data).toEqual(results[0].data);
    expect((await db.from("question_versions").select("id").eq("title", item.payload.title)).data).toHaveLength(1);
    expect((await admin.client.rpc("commit_import_batch", { p_batch_id: id, p_items: [{ ...item, payload: { ...item.payload, title: "different" } }] })).error).not.toBeNull();
  });

  it("immediately revokes work, reviews, notifications and images for an already-issued inactive session", async () => {
    const draft = await student.client.from("code_drafts").upsert({ student_id: student.id, question_version_id: versionId, language: "java", source_code: "draft" });
    expect(draft.error).toBeNull();
    await setStudentActive(db, student.id, false);
    try {
      for (const table of ["code_submissions", "code_runs", "code_drafts", "reviews", "notifications"] as const) {
        const rows = await student.client.from(table).select("*");
        expect(rows.error).toBeNull(); expect(rows.data).toEqual([]);
      }
      expect((await student.client.storage.from("question-assets").download(imagePath)).error).not.toBeNull();
      expect((await student.client.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null).select("id")).data).toEqual([]);
    } finally { await setStudentActive(db, student.id, true); }
  });
});
