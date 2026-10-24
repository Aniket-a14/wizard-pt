import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteUser, makeUser, service, type TestUser } from "./helpers/supabase";
import { QuizError, finalizeAttempt, getAttemptResult, loadAttemptSession, saveAnswer, startOrResumeAttempt } from "@/lib/quiz/server";

let admin: TestUser, student: TestUser, other: TestUser;
let assessmentId = "";
const qIds: string[] = [];
const optIds: Record<string, { correct: string; wrong: string; all: string[] }> = {};

async function mcq(title: string, options: { text: string; correct: boolean }[], multi = false) {
  const r = await admin.client.rpc("save_mcq_draft", { p_payload: { title, statement_md: title, marks: 1, mcq_multi: multi, explanation_md: `Because ${title}`, options } });
  if (r.error) throw r.error;
  const { question_id, version_id } = r.data as unknown as { question_id: string; version_id: string };
  qIds.push(question_id);
  const opts = await service().from("mcq_options").select("id, option_text").eq("question_version_id", version_id).order("display_order");
  const correct = options.findIndex((o) => o.correct);
  optIds[title] = { correct: opts.data![correct].id, wrong: opts.data![correct === 0 ? 1 : 0].id, all: opts.data!.map((o) => o.id) };
  return question_id;
}

beforeAll(async () => {
  admin = await makeUser("admin", "qz-admin");
  student = await makeUser("student", "qz-student");
  other = await makeUser("student", "qz-other");
  const q1 = await mcq("QZ-one", [{ text: "a", correct: true }, { text: "b", correct: false }]);
  const q2 = await mcq("QZ-two", [{ text: "a", correct: false }, { text: "b", correct: true }]);
  const q3 = await mcq("QZ-three", [{ text: "a", correct: true }, { text: "b", correct: false }]);
  const quiz = await admin.client.rpc("save_quiz_draft", {
    p_payload: {
      title: "QZ quiz", settings: { timer_minutes: 30, max_attempts: 2, negative_marking: { enabled: true, penalty_fraction: 0.25 }, show_score: "immediately", show_answers: "after_release" },
      questions: [q1, q2, q3].map((question_id) => ({ question_id, marks: 1 })),
    },
  });
  if (quiz.error) throw quiz.error;
  assessmentId = quiz.data as string;
  const pub = await admin.client.rpc("publish_assessment", { p_assessment_id: assessmentId });
  if (pub.error) throw pub.error;
});

afterAll(async () => {
  const s = service();
  const att = await s.from("assessment_attempts").select("id").eq("assessment_id", assessmentId);
  const ids = (att.data ?? []).map((a) => a.id);
  if (ids.length) await s.from("reviews").delete().in("attempt_id", ids);
  await s.from("assessment_attempts").delete().eq("assessment_id", assessmentId);
  await s.from("assessment_questions").delete().eq("assessment_id", assessmentId);
  await s.from("assessments").delete().eq("id", assessmentId);
  await s.from("questions").update({ current_version_id: null, published_version_id: null }).in("id", qIds);
  await s.from("questions").delete().in("id", qIds);
  await s.from("notifications").delete().in("recipient_id", [admin.id, student.id, other.id]);
  await Promise.all([admin, student, other].map(deleteUser));
});

describe("quiz attempts", () => {
  let attemptId = "";
  it("starting twice resumes the same open attempt", async () => {
    attemptId = await startOrResumeAttempt(assessmentId, student.id);
    expect(await startOrResumeAttempt(assessmentId, student.id)).toBe(attemptId);
    const [a, b] = await Promise.all([startOrResumeAttempt(assessmentId, other.id), startOrResumeAttempt(assessmentId, other.id)]);
    expect(a).toBe(b); // parallel starts also collapse to one attempt
  });

  it("the session never contains the answer key", async () => {
    const s = await loadAttemptSession(attemptId, student.id);
    expect(s.questions).toHaveLength(3);
    expect(JSON.stringify(s)).not.toMatch(/correct|explanation/i);
    expect(s.deadlineAt).not.toBeNull();
  });

  it("rejects other students, foreign options and multiple picks on a single-answer question", async () => {
    const s = await loadAttemptSession(attemptId, student.id);
    const q = s.questions.find((x) => x.statement_md === "QZ-one")!;
    const o = optIds["QZ-one"];
    await expect(saveAnswer({ attemptId, studentId: other.id, versionId: q.versionId, selected: [o.correct], marked: false })).rejects.toBeInstanceOf(QuizError);
    await expect(loadAttemptSession(attemptId, other.id)).rejects.toBeInstanceOf(QuizError);
    await expect(saveAnswer({ attemptId, studentId: student.id, versionId: q.versionId, selected: [optIds["QZ-two"].correct], marked: false })).rejects.toBeInstanceOf(QuizError);
    await expect(saveAnswer({ attemptId, studentId: student.id, versionId: q.versionId, selected: o.all, marked: false })).rejects.toBeInstanceOf(QuizError);
  });

  it("autosaves answers and a reload restores them", async () => {
    const s = await loadAttemptSession(attemptId, student.id);
    const get = (t: string) => s.questions.find((x) => x.statement_md === t)!;
    await saveAnswer({ attemptId, studentId: student.id, versionId: get("QZ-one").versionId, selected: [optIds["QZ-one"].correct], marked: false });
    await saveAnswer({ attemptId, studentId: student.id, versionId: get("QZ-two").versionId, selected: [optIds["QZ-two"].wrong], marked: true });
    const again = await loadAttemptSession(attemptId, student.id);
    expect(again.answers[get("QZ-one").versionId].selected).toEqual([optIds["QZ-one"].correct]);
    expect(again.answers[get("QZ-two").versionId].marked).toBe(true);
  });

  it("grades once: correct +1, wrong −25%, unanswered 0; concurrent submits are safe", async () => {
    await Promise.all([finalizeAttempt(attemptId, student.id), finalizeAttempt(attemptId, student.id), finalizeAttempt(attemptId, student.id)]);
    const a = await service().from("assessment_attempts").select("status, score, max_score").eq("id", attemptId).single();
    expect(a.data).toMatchObject({ status: "submitted", max_score: 3 });
    expect(Number(a.data!.score)).toBe(0.75);
    const notes = await service().from("notifications").select("id").eq("recipient_id", admin.id).eq("reference_id", attemptId);
    expect(notes.data).toHaveLength(1);
    await expect(saveAnswer({ attemptId, studentId: student.id, versionId: (await service().from("attempt_grades").select("question_version_id").eq("attempt_id", attemptId).limit(1)).data![0].question_version_id, selected: [], marked: false })).rejects.toBeInstanceOf(QuizError);
  });

  it("results obey release rules: score now, answers only after release", async () => {
    const r1 = await getAttemptResult(attemptId, student.id);
    expect(r1.score).toMatchObject({ score: 0.75, maxScore: 3, correct: 1, incorrect: 1, unanswered: 1 });
    expect(r1.review).toBeNull();
    expect(r1.answersPending).toBe(true);
    await expect(getAttemptResult(attemptId, other.id)).rejects.toBeInstanceOf(QuizError);

    await service().from("assessments").update({ answers_released_at: new Date().toISOString() }).eq("id", assessmentId);
    const r2 = await getAttemptResult(attemptId, student.id);
    expect(r2.review).toHaveLength(3);
    expect(r2.review!.find((q) => q.statement_md === "QZ-one")!.explanation).toBe("Because QZ-one");
    expect(r2.review!.flatMap((q) => q.options).filter((o) => o.correct)).toHaveLength(3);
  });

  it("attempt limits are enforced", async () => {
    const second = await startOrResumeAttempt(assessmentId, student.id);
    expect(second).not.toBe(attemptId);
    await finalizeAttempt(second, student.id);
    await expect(startOrResumeAttempt(assessmentId, student.id)).rejects.toThrow(/used all 2 attempts/);
  });

  it("an expired timer auto-submits the attempt", async () => {
    const id = await startOrResumeAttempt(assessmentId, other.id);
    await service().from("assessment_attempts").update({ deadline_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", id);
    await expect(loadAttemptSession(id, other.id)).rejects.toThrow(/Time is up/);
    const a = await service().from("assessment_attempts").select("status, auto_submitted").eq("id", id).single();
    expect(a.data).toEqual({ status: "submitted", auto_submitted: true });
  });
});
