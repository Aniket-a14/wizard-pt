import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createCodingDraft, deleteUser, makeUser, service, type TestUser } from "./helpers/supabase";

let admin: TestUser;
let student: TestUser;
let student2: TestUser;
const created: string[] = [];

beforeAll(async () => {
  admin = await makeUser("admin", "sec-admin");
  student = await makeUser("student", "sec-student");
  student2 = await makeUser("student", "sec-student2");
});

afterAll(async () => {
  const s = service();
  for (const id of created) {
    await s.from("code_submissions").delete().eq("question_version_id", id);
  }
  await s.from("questions").delete().in("created_by", [admin.id]);
  await s.from("notifications").delete().in("recipient_id", [student.id, student2.id]);
  await Promise.all([admin, student, student2].map(deleteUser));
});

describe("lifecycle + visibility", () => {
  let q: { question_id: string; version_id: string };

  it("drafts are invisible to students", async () => {
    q = await createCodingDraft(admin);
    created.push(q.version_id);
    const qs = await student.client.from("questions").select("id").eq("id", q.question_id);
    expect(qs.data).toEqual([]);
    const vs = await student.client.from("question_versions").select("id").eq("id", q.version_id);
    expect(vs.data).toEqual([]);
    const cfg = await student.client.from("coding_configs").select("*").eq("question_version_id", q.version_id);
    expect(cfg.data).toEqual([]);
  });

  it("publish validates the configuration (needs a hidden test)", async () => {
    const bad = await createCodingDraft(admin, { hidden: false, title: "No hidden" });
    const r = await admin.client.rpc("publish_coding_question", { p_question_id: bad.question_id });
    expect(r.error?.message).toBe("Cannot publish: Add at least one hidden test case");
  });

  it("student cannot publish", async () => {
    const r = await student.client.rpc("publish_coding_question", { p_question_id: q.question_id });
    expect(r.error).not.toBeNull();
    expect(r.error?.message).toMatch(/Admin only/i);
  });

  it("publishing makes it visible with ONLY public tests and no secrets", async () => {
    const r = await admin.client.rpc("publish_coding_question", { p_question_id: q.question_id });
    expect(r.error).toBeNull();

    const v = await student.client.from("question_versions").select("id,title").eq("id", q.version_id);
    expect(v.data?.length).toBe(1);

    const tests = await student.client.from("test_cases").select("*").eq("question_version_id", q.version_id);
    expect(tests.data?.length).toBe(1);
    expect(tests.data![0].visibility).toBe("public");
    expect(JSON.stringify(tests.data)).not.toContain("SECRET-HIDDEN");

    const secrets = await student.client.from("coding_secrets").select("*");
    expect(secrets.data).toEqual([]);
    const qsecrets = await student.client.from("question_secrets").select("*");
    expect(qsecrets.data).toEqual([]);
    const cfg = await student.client.from("coding_configs").select("starter_code, function_signature").eq("question_version_id", q.version_id);
    expect(cfg.data?.length).toBe(1);
  });

  it("student received a realtime-ready notification row", async () => {
    const n = await student.client.from("notifications").select("type,title,link").eq("reference_id", q.question_id);
    expect(n.data?.[0]?.type).toBe("problem_published");
    const other = await student2.client.from("notifications").select("id").neq("recipient_id", student2.id);
    expect(other.data).toEqual([]);
  });

  it("published versions are immutable (including via admin)", async () => {
    const upd = await admin.client.from("question_versions").update({ title: "hacked" }).eq("id", q.version_id);
    expect(upd.error?.message).toMatch(/immutable/i);
    const t = await admin.client.from("test_cases").delete().eq("question_version_id", q.version_id);
    expect(t.error?.message).toMatch(/immutable|published/i);
    const ins = await admin.client.from("test_cases").insert({ question_version_id: q.version_id, input: "x", expected_output: "y", visibility: "hidden" });
    expect(ins.error).not.toBeNull();
  });

  it("editing a published question creates v2; students keep v1 until v2 is published", async () => {
    const payload = {
      title: "Reverse Only the Letters v2", difficulty: "easy", statement_md: "Updated", examples: [], marks: 10,
      config: { function_signature: "public static String maskCode(String code)", starter_code: "x" },
      secrets: { template_prefix: "a", template_suffix: "b" },
      tests: [{ input: "a", expected_output: "a", visibility: "public" }, { input: "b", expected_output: "b", visibility: "hidden" }],
    };
    const r = await admin.client.rpc("save_coding_draft", { p_question_id: q.question_id, p_payload: payload });
    expect(r.error).toBeNull();
    const v2 = (r.data as unknown as { version_id: string }).version_id;
    expect(v2).not.toBe(q.version_id);

    const qrow = await admin.client.from("questions").select("published_version_id,current_version_id").eq("id", q.question_id).single();
    expect(qrow.data?.published_version_id).toBe(q.version_id);
    expect(qrow.data?.current_version_id).toBe(v2);

    const sv2 = await student.client.from("question_versions").select("id").eq("id", v2);
    expect(sv2.data).toEqual([]); // draft v2 hidden
    const v1 = await admin.client.from("question_versions").select("title").eq("id", q.version_id).single();
    expect(v1.data?.title).toBe("Reverse Only the Letters"); // v1 untouched

    const pub = await admin.client.rpc("publish_coding_question", { p_question_id: q.question_id });
    expect(pub.error).toBeNull();
    const after = await admin.client.from("questions").select("published_version_id").eq("id", q.question_id).single();
    expect(after.data?.published_version_id).toBe(v2);
    const n = await student.client.from("notifications").select("type").eq("reference_id", q.question_id).eq("type", "problem_updated");
    expect(n.data?.length).toBe(1);
  });
});

describe("authorization", () => {
  it("anonymous users see nothing", async () => {
    const a = anon();
    for (const t of ["questions", "question_versions", "test_cases", "profiles", "notifications", "code_submissions"] as const) {
      const r = await a.from(t).select("*").limit(1);
      expect(r.data ?? []).toEqual([]);
    }
  });

  it("student cannot mutate content or escalate their role", async () => {
    const ins = await student.client.from("questions").insert({ type: "coding", created_by: student.id });
    expect(ins.error).not.toBeNull();

    const role = await student.client.from("profiles").update({ role: "admin" }).eq("id", student.id);
    expect(role.error).not.toBeNull();
    const check = await service().from("profiles").select("role").eq("id", student.id).single();
    expect(check.data?.role).toBe("student");

    const name = await student.client.from("profiles").update({ display_name: "New Name" }).eq("id", student.id);
    expect(name.error).toBeNull();

    const asg = await student.client.from("assessments").insert({ title: "x", created_by: student.id });
    expect(asg.error).not.toBeNull();
    const rv = await student.client.from("reviews").insert({ code_submission_id: crypto.randomUUID(), reviewer_id: student.id, status: "accepted" });
    expect(rv.error).not.toBeNull();
  });

  it("answer keys, grades and attempts are not readable by students", async () => {
    for (const t of ["mcq_correct_options", "attempt_grades", "attempt_answers", "assessment_attempts", "code_submission_private", "imports"] as const) {
      const r = await student.client.from(t).select("*").limit(5);
      expect(r.data ?? []).toEqual([]);
    }
  });

  it("students cannot read each other's drafts and submissions", async () => {
    const s = service();
    const q = await createCodingDraft(admin, { title: "Isolation" });
    await admin.client.rpc("publish_coding_question", { p_question_id: q.question_id });
    created.push(q.version_id);
    const d = await student.client.from("code_drafts").upsert({ student_id: student.id, question_version_id: q.version_id, source_code: "mine" });
    expect(d.error).toBeNull();
    const forged = await student2.client.from("code_drafts").upsert({ student_id: student.id, question_version_id: q.version_id, source_code: "forged" });
    expect(forged.error).not.toBeNull();
    const peek = await student2.client.from("code_drafts").select("*").eq("student_id", student.id);
    expect(peek.data).toEqual([]);

    await s.from("code_submissions").insert({ student_id: student.id, question_version_id: q.version_id, source_code: "int x;", idempotency_key: "k1" });
    const peekSub = await student2.client.from("code_submissions").select("*");
    expect(peekSub.data).toEqual([]);
    const own = await student.client.from("code_submissions").select("source_code").eq("idempotency_key", "k1");
    expect(own.data?.length).toBe(1);
    const forgedSub = await student.client.from("code_submissions").insert({ student_id: student.id, question_version_id: q.version_id, source_code: "x", idempotency_key: "k2", verdict: "accepted" });
    expect(forgedSub.error).not.toBeNull(); // students cannot write submissions/verdicts at all
    const edit = await s.from("code_submissions").update({ source_code: "changed" }).eq("idempotency_key", "k1");
    expect(edit.error?.message).toMatch(/immutable/i);
  });

  it("students can only mark their own notifications read, nothing else", async () => {
    const mine = await student.client.from("notifications").select("id").limit(1);
    const id = mine.data![0].id;
    const ok = await student.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    expect(ok.error).toBeNull();
    const bad = await student.client.from("notifications").update({ title: "tampered" }).eq("id", id);
    expect(bad.error).not.toBeNull();
  });
});

describe("realtime", () => {
  it("student receives a push when admin publishes (private, RLS-filtered stream)", async () => {
    const received: string[] = [];
    let ready: () => void = () => undefined;
    const subscribed = new Promise<void>((r) => (ready = r));
    const ch = student.client
      .channel("t-notifs")
      .on("system", {}, (p: { extension?: string; status?: string }) => {
        if (p.extension === "postgres_changes" && p.status === "ok") ready();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${student.id}` }, (p) => {
        received.push((p.new as { title: string }).title);
      });
    ch.subscribe();
    await Promise.race([subscribed, new Promise((_, rej) => setTimeout(() => rej(new Error("subscribe timeout")), 10000))]);
    const q = await createCodingDraft(admin, { title: "Realtime Probe" });
    created.push(q.version_id);
    await admin.client.rpc("publish_coding_question", { p_question_id: q.question_id });
    for (let i = 0; i < 40 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 250));
    await student.client.removeChannel(ch);
    expect(received.some((t) => t.includes("Realtime Probe"))).toBe(true);
  });
});
