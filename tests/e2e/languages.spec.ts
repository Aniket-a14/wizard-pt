import { expect, test } from "@playwright/test";
import { ADMIN, STUDENT, login, service, setMonaco } from "./helpers";
import { cleanupCoding, deleteUser, makeUser, type TestUser } from "../helpers/supabase";
import { codingDraftSchema } from "@/lib/validation/question";
import { prepareCoding } from "@/lib/coding/prepare";

const TITLE = "E2E Languages twoSum";
const CPP = `vector<int> twoSum(vector<int>& nums, int target) { for (int i = 0; i < (int)nums.size(); i++) for (int j = i + 1; j < (int)nums.size(); j++) if (nums[i] + nums[j] == target) return {i, j}; return {}; }`;
const C = `int* twoSum(int* nums, int numsSize, int target, int* returnSize) { int* r = malloc(2 * sizeof(int)); for (int i = 0; i < numsSize; i++) for (int j = i + 1; j < numsSize; j++) if (nums[i] + nums[j] == target) { r[0] = i; r[1] = j; *returnSize = 2; return r; } *returnSize = 0; return r; }`;
const JAVA = `public static int[] twoSum(int[] nums, int target) { for (int i = 0; i < nums.length; i++) for (int j = i + 1; j < nums.length; j++) if (nums[i] + nums[j] == target) return new int[]{i, j}; return new int[0]; }`;

let admin: TestUser;
let questionId = "";

test.beforeAll(async () => {
  admin = await makeUser("admin", "lang-e2e-admin");
  const prep = prepareCoding(codingDraftSchema.parse({
    questionId: null, title: TITLE, statement_md: "Return the indices of the two numbers that add up to the target.", marks: 10,
    config: { execution_mode: "function", function_signature: "public static int[] twoSum(int[] nums, int target)", starter_code: "" },
    reference_solution: JAVA,
    languages: { cpp: { reference_solution: CPP }, c: { reference_solution: C } },
    tests: [
      { input: "2 7 11 15\n9", expected_output: "0 1", visibility: "public" },
      { input: "3 2 4\n6", expected_output: "1 2", visibility: "public" },
      { input: "3 3\n6", expected_output: "0 1", visibility: "hidden" },
    ],
  }));
  if (!prep.ok) throw new Error(prep.error);
  const saved = await admin.client.rpc("save_coding_draft", { p_payload: prep.payload as never });
  if (saved.error) throw saved.error;
  questionId = (saved.data as unknown as { question_id: string }).question_id;
  const pub = await admin.client.rpc("publish_coding_question", { p_question_id: questionId });
  if (pub.error) throw pub.error;
});

test.afterAll(async () => {
  const db = service();
  const { data: vs } = await db.from("question_versions").select("id").eq("question_id", questionId);
  const vids = (vs ?? []).map((v) => v.id);
  if (vids.length) {
    await db.from("code_drafts").delete().in("question_version_id", vids);
    await db.from("code_runs").delete().in("question_version_id", vids);
  }
  await cleanupCoding([questionId]);
  await db.from("notifications").delete().ilike("title", "%E2E%");
  await db.from("notifications").delete().eq("recipient_id", admin.id);
  await deleteUser(admin);
});

test("a student picks C++ or C, gets that language's starter, runs and submits in it", async ({ page }) => {
  page.on("dialog", (d) => d.accept()); // "Submit your solution?" confirmation
  await login(page, STUDENT, /\/student/);
  await page.goto(`/student/problems/${questionId}`);
  const editor = page.locator(".view-lines").first();
  const picker = page.getByLabel("Programming language");

  // Java by default
  await expect(picker).toHaveValue("java");
  await expect(editor).toContainText("public static int[] twoSum", { timeout: 60_000 });

  // switch to C++: the starter is the derived C++ declaration, and the choice is remembered
  await picker.selectOption("cpp");
  await expect(page).toHaveURL(/lang=cpp/);
  await expect(page.getByLabel("Programming language")).toHaveValue("cpp");
  await expect(page.locator(".view-lines").first()).toContainText("vector<int> twoSum(vector<int>& nums, int target)", { timeout: 60_000 });

  // a wrong C++ answer fails; the right one passes the samples
  await setMonaco(page, page.locator("body"), "vector<int> twoSum(vector<int>& nums, int target) { return {0, 0}; }");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText("Wrong Answer").first()).toBeVisible({ timeout: 90_000 });
  await setMonaco(page, page.locator("body"), CPP);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText("2/2 passed").first()).toBeVisible({ timeout: 90_000 });

  // a compile error points at the student's own line
  await setMonaco(page, page.locator("body"), "vector<int> twoSum(vector<int>& nums, int target) {\n  int x = ;\n  return {};\n}");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText(/Line 2/).first()).toBeVisible({ timeout: 90_000 });

  // submit the C++ solution
  await setMonaco(page, page.locator("body"), CPP);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Submission result")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Accepted", { exact: true }).first()).toBeVisible();

  // the other languages keep their own draft: Java still has its starter, C shows the C declaration
  await page.getByLabel("Programming language").selectOption("java");
  await expect(page.locator(".view-lines").first()).toContainText("public static int[] twoSum", { timeout: 60_000 });
  await page.getByLabel("Programming language").selectOption("c");
  await expect(page.locator(".view-lines").first()).toContainText("int* twoSum(int* nums, int numsSize, int target, int* returnSize)", { timeout: 60_000 });

  // the submissions list records which language each one used
  await page.getByRole("tab", { name: /Submissions/ }).click();
  await expect(page.getByText("C++", { exact: true }).first()).toBeVisible();
  const sub = await service().from("code_submissions").select("language").eq("student_id", (await service().from("profiles").select("id").eq("role", "student").limit(1).single()).data!.id).order("submitted_at", { ascending: false }).limit(1).single();
  expect(sub.data!.language).toBe("cpp");
});

test("the API rejects a language the problem does not offer", async ({ page }) => {
  await login(page, STUDENT, /\/student/);
  const vers = await service().from("question_versions").select("id").eq("question_id", questionId).limit(1).single();
  const body = { versionId: vers.data!.id, code: "int main(){return 0;}", idempotencyKey: `lang-key-${Date.now()}` };
  expect((await page.request.post("/api/code/submit", { data: { ...body, language: "rust" } })).status()).toBe(400);
  expect((await page.request.post("/api/code/run", { data: { versionId: body.versionId, code: body.code, language: "rust" } })).status()).toBe(400);
});

test("the admin editor derives the C++ / C signature and explains what C cannot express", async ({ page }) => {
  await login(page, ADMIN, /\/admin/);
  await page.goto("/admin/questions/new/coding");
  await page.getByRole("tab", { name: /Code setup/ }).click();
  const sig = page.getByLabel("Method signature");
  await sig.fill("public static int[] twoSum(int[] nums, int target)");

  const panel = page;
  await panel.getByLabel("C++", { exact: true }).check();
  await panel.getByLabel("C", { exact: true }).check();
  await expect(panel.getByText("vector<int> twoSum(vector<int>& nums, int target)")).toBeVisible();
  await expect(panel.getByText("int* twoSum(int* nums, int numsSize, int target, int* returnSize)")).toBeVisible();
  await expect(panel.getByTestId("reference-editor-cpp")).toBeVisible();

  // a signature C cannot express: C++ still works, C is explained
  await sig.fill("public static List<Integer> evens(int[] nums)");
  await expect(panel.getByText("vector<int> evens(vector<int>& nums)")).toBeVisible();
  await expect(panel.getByText(/C cannot express the return value of type List<Integer>/).first()).toBeVisible();
});
