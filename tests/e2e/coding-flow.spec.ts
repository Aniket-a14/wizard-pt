import { expect, test } from "@playwright/test";
import { ADMIN, STUDENT, cleanupE2E, login, setMonaco } from "./helpers";

const TITLE = `Reverse Only the Letters E2E ${Date.now().toString().slice(-6)}`;

const PASTED = `Problem 2 — ${TITLE} [Easy | Strings + Two Pointers]

An Accenture security team masks product codes before sharing them with a vendor.

Masking reverses the order of the LETTERS in the code, while every non-letter stays exactly where it is.

Function signature:

public static String maskCode(String code)

Input format:
One line containing the code.

Output format:
The masked code.

Constraints:
1 ≤ code.length() ≤ 100000

Example 1:
Input: AB-12-CD
Output: DC-12-BA

Example 2:
Input: Ja#va-21
Output: av#aJ-21

Example 3:
Input: 1234
Output: 1234

Example 4:
Input: x-Y
Output: Y-x`;

const SOLUTION = `public static String maskCode(String code) {
    char[] chars = code.toCharArray();
    int left = 0;
    int right = chars.length - 1;
    while (left < right) {
        if (!Character.isLetter(chars[left])) {
            left++;
        } else if (!Character.isLetter(chars[right])) {
            right--;
        } else {
            char temp = chars[left];
            chars[left] = chars[right];
            chars[right] = temp;
            left++;
            right--;
        }
    }
    return new String(chars);
}`;

test.beforeAll(async () => {
  await cleanupE2E();
});
test.afterAll(async () => {
  await cleanupE2E();
});

test("admin publishes a pasted problem → student gets it live → runs, submits → admin reviews → student reads feedback", async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const studentCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const student = await studentCtx.newPage();
  admin.on("dialog", (d) => d.accept());
  student.on("dialog", (d) => d.accept());

  // ---- both log in; the student sits on the assessments page
  await login(admin, ADMIN, /\/admin/);
  await login(student, STUDENT, /\/student/);
  await student.goto("/student/assessments");
  await expect(student.getByRole("heading", { name: "Assessments" })).toBeVisible();
  await expect(student.getByRole("link", { name: TITLE })).toHaveCount(0);

  // ---- admin: create from pasted text
  await admin.goto("/admin/questions/new/coding");
  await admin.getByPlaceholder(/Problem 2/).fill(PASTED);
  await admin.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(admin.getByLabel("Title", { exact: true })).toHaveValue(TITLE);
  await expect(admin.getByText("Imported content needs your review")).toBeVisible();

  // code setup
  await admin.getByRole("tab", { name: /Code setup/ }).click();
  await expect(admin.getByText("maskCode(String) → String")).toBeVisible();
  await admin.getByRole("button", { name: "Generate from signature" }).click();
  await setMonaco(admin, admin.getByTestId("reference-editor"), SOLUTION);

  // tests: 4 public came from the examples; add hidden ones
  await admin.getByRole("tab", { name: /Test cases/ }).click();
  await expect(admin.getByText("4 public · 0 hidden")).toBeVisible();
  await admin.getByRole("button", { name: "+ Hidden test" }).click();
  await admin.getByRole("button", { name: "+ Hidden test" }).click();
  const inputs = admin.getByLabel("Input (stdin)");
  const expecteds = admin.getByLabel("Expected output");
  await inputs.nth(4).fill("a");
  await expecteds.nth(4).fill("a");
  await inputs.nth(5).fill("a-b-c#D");
  await expecteds.nth(5).fill("D-c-b#a");
  await expect(admin.getByText("4 public · 2 hidden")).toBeVisible();

  // save + validate with the reference solution (real Java run)
  await admin.getByRole("button", { name: "Save draft" }).click();
  await expect(admin.getByText("Draft saved")).toBeVisible();
  await admin.getByRole("tab", { name: /Review & publish/ }).click();
  await admin.getByRole("button", { name: "Run all tests" }).click();
  await expect(admin.getByText("Reference solution passes all 6 tests")).toBeVisible({ timeout: 90_000 });

  // ---- publish → student sees it WITHOUT reloading (realtime)
  await admin.getByRole("button", { name: "Publish", exact: true }).first().click();
  await expect(admin.getByText(/Published — the student is notified/)).toBeVisible();
  await expect(student.getByRole("link", { name: TITLE })).toBeVisible({ timeout: 30_000 });
  await expect(student.getByText(`New problem: ${TITLE}`)).toBeVisible(); // toast from the realtime push

  // ---- student solves it
  await student.getByRole("link", { name: TITLE }).click();
  await expect(student.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(student.getByText("An Accenture security team masks product codes")).toBeVisible();
  // function-only mode: the prepared method is already in the editor
  await expect(student.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });
  await expect(student.locator(".view-lines").first()).toContainText("maskCode");

  // a wrong first attempt: Run shows real failures
  await setMonaco(student, student.locator("body"), `public static String maskCode(String code) { return new StringBuilder(code).reverse().toString(); }`);
  await student.getByRole("button", { name: "Run", exact: true }).click();
  await expect(student.getByText("Wrong Answer").first()).toBeVisible({ timeout: 90_000 });
  await expect(student.getByText(/\/4 passed/).first()).toBeVisible();

  // fix and run again → all samples pass
  await setMonaco(student, student.locator("body"), SOLUTION);
  await student.getByRole("button", { name: "Run", exact: true }).click();
  await expect(student.getByText("4/4 passed").first()).toBeVisible({ timeout: 90_000 });
  await expect(student.getByText("This was only a run — nothing was submitted.")).toBeVisible();

  // submit → permanent, graded on hidden tests as well
  await student.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(student.getByText("Submission result")).toBeVisible({ timeout: 120_000 });
  await expect(student.getByText("Accepted", { exact: true }).first()).toBeVisible();
  await expect(student.getByText("2/2 passed")).toBeVisible(); // hidden tests: count only
  await expect(student.getByText("SECRET")).toHaveCount(0);

  // ---- admin received a notification and reviews it
  await expect(admin.getByText(`Submission: ${TITLE}`)).toBeVisible({ timeout: 30_000 });
  await admin.goto("/admin/submissions");
  await admin.getByRole("link", { name: TITLE }).first().click();
  await expect(admin.getByText("Automatic evaluation")).toBeVisible();
  await expect(admin.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });
  await expect(admin.getByText("Pending Review").first()).toBeVisible().catch(() => undefined);
  await admin.getByLabel("Feedback").fill("Your two-pointer logic is correct. Nice and clean.");
  await admin.getByRole("button", { name: "Publish feedback" }).click();
  await expect(admin.getByText(/Feedback published/).first()).toBeVisible();

  // ---- student sees the feedback notification and reads it, with the exact submitted code
  await expect(student.getByText(`Feedback on ${TITLE}`)).toBeVisible({ timeout: 30_000 });
  await student.goto("/student/submissions");
  await student.getByRole("link", { name: TITLE }).first().click();
  await expect(student.getByText("Your two-pointer logic is correct. Nice and clean.")).toBeVisible();
  await expect(student.getByText("Your submitted code (exact snapshot)")).toBeVisible();
  await expect(student.locator(".view-lines").first()).toContainText("maskCode", { timeout: 60_000 });

  await adminCtx.close();
  await studentCtx.close();
});
