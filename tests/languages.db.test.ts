import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { codingDraftSchema } from "@/lib/validation/question";
import { prepareCoding } from "@/lib/coding/prepare";
import { cleanupCoding, deleteUser, makeUser, service, type TestUser } from "./helpers/supabase";

/** C++ / C stored per problem version, hidden from students, and graded end to end through the real pipeline. */
const gccReady = (() => {
  try {
    execFileSync("docker", ["image", "inspect", process.env.RUNNER_DOCKER_GCC_IMAGE ?? "gcc:14"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const CPP_REF = `vector<int> twoSum(vector<int>& nums, int target) { for (int i = 0; i < (int)nums.size(); i++) for (int j = i + 1; j < (int)nums.size(); j++) if (nums[i] + nums[j] == target) return {i, j}; return {}; }`;
const C_REF = `int* twoSum(int* nums, int numsSize, int target, int* returnSize) { int* r = malloc(2 * sizeof(int)); for (int i = 0; i < numsSize; i++) for (int j = i + 1; j < numsSize; j++) if (nums[i] + nums[j] == target) { r[0] = i; r[1] = j; *returnSize = 2; return r; } *returnSize = 0; return r; }`;
const JAVA_REF = `public static int[] twoSum(int[] nums, int target) { for (int i = 0; i < nums.length; i++) for (int j = i + 1; j < nums.length; j++) if (nums[i] + nums[j] == target) return new int[]{i, j}; return new int[0]; }`;

let admin: TestUser, student: TestUser, other: TestUser;
let questionId = "";
let versionId = "";

beforeAll(async () => {
  admin = await makeUser("admin", "lang-admin");
  student = await makeUser("student", "lang-student");
  other = await makeUser("student", "lang-other");
  const draft = codingDraftSchema.parse({
    questionId: null,
    title: "LANG twoSum",
    statement_md: "Return the indices of the two numbers that add up to target.",
    marks: 10,
    config: { execution_mode: "function", function_signature: "public static int[] twoSum(int[] nums, int target)", starter_code: "" },
    reference_solution: JAVA_REF,
    languages: { cpp: { reference_solution: CPP_REF }, c: { reference_solution: C_REF } },
    tests: [
      { input: "2 7 11 15\n9", expected_output: "0 1", visibility: "public" },
      { input: "3 2 4\n6", expected_output: "1 2", visibility: "public" },
      { input: "3 3\n6", expected_output: "0 1", visibility: "hidden" },
      { input: "1 5 9 2\n11", expected_output: "2 3", visibility: "hidden" },
    ],
  });
  const prep = prepareCoding(draft);
  if (!prep.ok) throw new Error(prep.error);
  const saved = await admin.client.rpc("save_coding_draft", { p_payload: prep.payload as never });
  if (saved.error) throw saved.error;
  ({ question_id: questionId, version_id: versionId } = saved.data as unknown as { question_id: string; version_id: string });
  const pub = await admin.client.rpc("publish_coding_question", { p_question_id: questionId });
  if (pub.error) throw pub.error;
});

afterAll(async () => {
  await cleanupCoding([questionId]);
  await service().from("notifications").delete().in("recipient_id", [admin.id, student.id, other.id]);
  await Promise.all([admin, student, other].map(deleteUser));
});

describe("per-language data", () => {
  it("students can read each language's declaration and starter, but never the wrapper or reference solutions", async () => {
    const cfg = await student.client.from("coding_configs").select("variants").eq("question_version_id", versionId).single();
    const v = cfg.data!.variants as Record<string, { function_signature: string; starter_code: string }>;
    expect(Object.keys(v).sort()).toEqual(["c", "cpp"]);
    expect(v.cpp.function_signature).toBe("vector<int> twoSum(vector<int>& nums, int target)");
    expect(v.c.function_signature).toBe("int* twoSum(int* nums, int numsSize, int target, int* returnSize)");
    expect(JSON.stringify(cfg.data)).not.toMatch(/WPT_RESULT|return \{i, j\}|malloc/);
    const secrets = await student.client.from("coding_secrets").select("*").eq("question_version_id", versionId);
    expect(secrets.data).toEqual([]);
    const priv = await admin.client.from("coding_secrets").select("variants").eq("question_version_id", versionId).single();
    const sv = priv.data!.variants as Record<string, { template_suffix: string; reference_solution: string }>;
    expect(sv.cpp.reference_solution).toBe(CPP_REF);
    expect(sv.c.template_suffix).toContain("WPT_RESULT_BEGIN");
  });

  it("a student keeps one draft per language and nobody else can see them", async () => {
    const mine = (language: string, code: string) => student.client.from("code_drafts").upsert({ student_id: student.id, question_version_id: versionId, language, source_code: code }, { onConflict: "student_id,question_version_id,language" });
    expect((await mine("java", "// java draft")).error).toBeNull();
    expect((await mine("cpp", "// cpp draft")).error).toBeNull();
    expect((await mine("cpp", "// cpp draft v2")).error).toBeNull();
    const rows = await student.client.from("code_drafts").select("language, source_code").eq("question_version_id", versionId).order("language");
    expect(rows.data).toEqual([{ language: "cpp", source_code: "// cpp draft v2" }, { language: "java", source_code: "// java draft" }]);
    expect((await other.client.from("code_drafts").select("language").eq("question_version_id", versionId)).data).toEqual([]);
    const bad = await student.client.from("code_drafts").upsert({ student_id: student.id, question_version_id: versionId, language: "rust", source_code: "x" }, { onConflict: "student_id,question_version_id,language" });
    expect(bad.error).not.toBeNull();
  });

  it("the database refuses a submission in an unknown language", async () => {
    const r = await service().from("code_submissions").insert({ student_id: student.id, question_version_id: versionId, source_code: "x", language: "rust", idempotency_key: "rust-1", max_marks: 10 });
    expect(r.error?.code).toBe("23514");
  });

  it("editing a published problem clones the per-language data into the new draft version", async () => {
    const nv = await admin.client.rpc("new_draft_version", { p_question_id: questionId });
    expect(nv.error).toBeNull();
    const [a, b] = await Promise.all([
      service().from("coding_configs").select("variants").eq("question_version_id", versionId).single(),
      service().from("coding_configs").select("variants").eq("question_version_id", nv.data as string).single(),
    ]);
    expect(b.data!.variants).toEqual(a.data!.variants);
    const sb = await service().from("coding_secrets").select("variants").eq("question_version_id", nv.data as string).single();
    expect(Object.keys(sb.data!.variants as object).sort()).toEqual(["c", "cpp"]);
  });
});

describe.skipIf(!gccReady)("grading in each language (real DB, real sandbox)", () => {
  async function submit(language: string, code: string, key: string) {
    const r = await service().from("code_submissions").insert({ student_id: student.id, question_version_id: versionId, source_code: code, language, idempotency_key: key, max_marks: 10 }).select("id").single();
    if (r.error) throw r.error;
    return r.data.id;
  }

  it.each([
    ["java", JAVA_REF],
    ["cpp", CPP_REF],
    ["c", C_REF],
  ])("%s submission is graded accepted against every public and hidden test", async (language, code) => {
    vi.resetModules();
    process.env.RUNNER_PROVIDER = "docker";
    process.env.RUNNER_ALLOW_DOCKER = "1";
    const { processSubmission } = await import("@/lib/coding/submission");
    const id = await submit(language, code, `lang-${language}`);
    await processSubmission(id);
    const s = await service().from("code_submissions").select("status, verdict, language, passed_public, total_public, passed_hidden, total_hidden").eq("id", id).single();
    expect(s.data).toMatchObject({ status: "completed", verdict: "accepted", language, passed_public: 2, total_public: 2, passed_hidden: 2, total_hidden: 2 });
  }, 180_000);

  it("a wrong C++ answer is not accepted and its compile errors show the student's own lines", async () => {
    vi.resetModules();
    process.env.RUNNER_PROVIDER = "docker";
    process.env.RUNNER_ALLOW_DOCKER = "1";
    const { processSubmission } = await import("@/lib/coding/submission");
    const wrong = await submit("cpp", "vector<int> twoSum(vector<int>& nums, int target) { return {0, 0}; }", "lang-cpp-wrong");
    await processSubmission(wrong);
    expect((await service().from("code_submissions").select("verdict").eq("id", wrong).single()).data!.verdict).not.toBe("accepted");
    const broken = await submit("cpp", "vector<int> twoSum(vector<int>& nums, int target) {\n  int x = ;\n  return {};\n}", "lang-cpp-broken");
    await processSubmission(broken);
    const b = await service().from("code_submissions").select("verdict, compile_output").eq("id", broken).single();
    expect(b.data!.verdict).toBe("compile_error");
    expect(b.data!.compile_output).toMatch(/Line 2/);
  }, 180_000);
});
