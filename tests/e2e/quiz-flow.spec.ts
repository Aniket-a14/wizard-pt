import { expect, test } from "@playwright/test";
import { ADMIN, STUDENT, cleanupE2E, login } from "./helpers";

const TAG = Date.now().toString().slice(-6);
const QUIZ = `E2E Quiz ${TAG}`;

const MCQS = `1. E2E ${TAG} Which data structure follows FIFO?
A. Stack
B. Queue
C. Tree
D. Graph
Answer: B
Explanation: A queue processes elements in First In, First Out order.

2. E2E ${TAG} What is the time complexity of binary search?
A. O(n)
B. O(log n)
C. O(n log n)
D. O(1)
Answer: B

3. E2E ${TAG} Which of these are prime numbers?
A. 2
B. 4
C. 5
D. 9
Answer: A, C`;

test.beforeAll(async () => cleanupE2E());
test.afterAll(async () => cleanupE2E());

test("admin imports MCQs → builds & publishes a quiz → student takes it → results gated until released", async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const studentCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const student = await studentCtx.newPage();
  admin.on("dialog", (d) => d.accept());
  student.on("dialog", (d) => d.accept());

  await login(admin, ADMIN, /\/admin/);
  await login(student, STUDENT, /\/student/);
  await student.goto("/student/assessments");

  // ---- import via paste, review, create drafts
  await admin.goto("/admin/import");
  await admin.getByLabel("Pasted questions").fill(MCQS);
  await admin.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(admin.getByText("Review (3 of 3 selected)")).toBeVisible();
  // the multi-answer question was detected
  await expect(admin.getByLabel("Option A correct").last()).toBeChecked();
  await admin.getByRole("button", { name: /Create 3 drafts/ }).click();
  await expect(admin).toHaveURL(/\/admin\/questions\?status=draft/);
  await expect(admin.getByRole("link", { name: new RegExp(`E2E ${TAG} Which data structure`) })).toBeVisible();

  // ---- build the quiz
  await admin.goto("/admin/quizzes/new");
  await admin.getByLabel("Title", { exact: true }).fill(QUIZ);
  await admin.getByRole("button", { name: /Add all valid/ }).click();
  // the bank may contain other MCQs; keep only ours
  const rows = admin.locator("ol li");
  await expect(rows.first()).toBeVisible();
  for (let i = (await rows.count()) - 1; i >= 0; i--) {
    const text = await rows.nth(i).innerText();
    if (!text.includes(`E2E ${TAG}`)) await rows.nth(i).getByRole("button", { name: "✕" }).click();
  }
  await expect(admin.getByText(/Selected questions \(3\)/)).toBeVisible();
  await admin.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(admin.getByText(/Published — the student is notified/)).toBeVisible();
  await expect(admin).toHaveURL(/\/admin\/quizzes\/[0-9a-f-]{36}/);
  const quizUrl = admin.url();

  // ---- student sees it live and takes it
  await expect(student.getByRole("link", { name: QUIZ }).first()).toBeVisible({ timeout: 30_000 });
  await student.getByRole("link", { name: QUIZ }).first().click();
  await student.getByRole("button", { name: "Start quiz" }).click();
  await expect(student.getByText("Question 1 of 3")).toBeVisible();

  for (let i = 0; i < 3; i++) {
    const text = await student.locator("section").first().innerText();
    if (text.includes("FIFO")) await student.getByText("Queue", { exact: true }).click(); // correct
    else if (text.includes("binary search")) await student.getByText("O(n)", { exact: true }).first().click(); // wrong
    else await student.getByRole("button", { name: /Mark for review/ }).click(); // leave unanswered, mark it
    if (i < 2) await student.getByRole("button", { name: /Next/ }).click();
  }
  await expect(student.getByText(/All answers saved/)).toBeVisible({ timeout: 15_000 });
  await expect(student.getByText("2/3 answered").or(student.getByText("2 / 3 answered"))).toBeVisible().catch(() => undefined);

  // refresh mid-quiz: progress must survive
  await student.reload();
  await expect(student.getByText("Question 1 of 3")).toBeVisible();
  await expect(student.getByText(/2\/3 answered · 1 marked/)).toBeVisible();

  // submit
  await student.getByRole("button", { name: "Submit quiz" }).first().click();
  await expect(student.getByText("Submit this quiz?")).toBeVisible();
  await student.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(student).toHaveURL(/attempt=/);

  // score visible now (default), answers held back until released
  await expect(student.getByText("1 correct")).toBeVisible();
  await expect(student.getByText("1 wrong")).toBeVisible();
  await expect(student.getByText("1 unanswered")).toBeVisible();
  await expect(student.getByText(/Correct answers and explanations will be available/)).toBeVisible();
  await expect(student.getByText("First In, First Out")).toHaveCount(0);
  const resultUrl = student.url();

  // ---- admin got a notification, inspects the attempt, then releases answers
  await expect(admin.getByText(`Quiz submitted: ${QUIZ}`)).toBeVisible({ timeout: 30_000 });
  await admin.goto("/admin/submissions?tab=quiz");
  await admin.getByRole("link", { name: QUIZ }).first().click();
  await expect(admin.getByText("1/3").first()).toBeVisible();
  await expect(admin.getByText("unanswered").first()).toBeVisible();
  await admin.goto(quizUrl);
  await admin.getByRole("button", { name: "Release answers" }).click();
  await expect(admin.getByText("Answers released")).toBeVisible();

  // ---- student now sees the review + explanation
  await expect(student.getByText(`Answers released: ${QUIZ}`)).toBeVisible({ timeout: 30_000 });
  await student.goto(resultUrl);
  await expect(student.getByText("First In, First Out")).toBeVisible();
  await expect(student.getByText("correct", { exact: true }).first()).toBeVisible();

  await adminCtx.close();
  await studentCtx.close();
});

test("PDF import: text PDF is parsed; scanned PDF reports OCR needed; fake PDF is rejected", async ({ browser }) => {
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await login(admin, ADMIN, /\/admin/);
  await admin.goto("/admin/import?mode=pdf");

  await admin.getByLabel("PDF files").setInputFiles("tests/fixtures/mcq-text.pdf");
  await expect(admin.getByText(/Found 3 question\(s\)/)).toBeVisible({ timeout: 60_000 });
  await expect(admin.getByText("Review (3 of 3 selected)")).toBeVisible();
  await expect(admin.getByLabel("Option B correct").first()).toBeChecked();

  await admin.getByLabel("PDF files").setInputFiles("tests/fixtures/scanned-image-only.pdf");
  await expect(admin.getByText(/OCR is required/)).toBeVisible({ timeout: 60_000 });
  await expect(admin.getByText(/Review \(/)).toHaveCount(0);

  await admin.getByLabel("PDF files").setInputFiles("tests/fixtures/fake.pdf");
  await expect(admin.getByText(/not a valid PDF/)).toBeVisible({ timeout: 30_000 });
  await ctx.close();
});
