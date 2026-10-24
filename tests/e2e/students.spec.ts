import { expect, test } from "@playwright/test";
import { ADMIN, login, service } from "./helpers";

const EMAIL = `e2e-many-${Date.now()}@test.local`;

test.afterAll(async () => {
  const db = service();
  const l = await db.auth.admin.listUsers({ perPage: 1000 });
  const u = l.data.users.find((x) => x.email === EMAIL);
  if (u) await db.auth.admin.deleteUser(u.id);
});

test("admin adds a student, the student signs in, then admin deactivates and reactivates them", async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  admin.on("dialog", (d) => d.accept());
  await login(admin, ADMIN, /\/admin/);

  await admin.getByRole("link", { name: "Students" }).click();
  await expect(admin.getByRole("heading", { name: "Students", exact: true })).toBeVisible();
  await admin.getByLabel("Name").fill("E2E Many Student");
  await admin.getByLabel("Email").fill(EMAIL);
  await admin.getByRole("button", { name: "Add student" }).click();
  const password = (await admin.getByTestId("new-password").textContent())!.trim();
  expect(password.length).toBeGreaterThanOrEqual(10);
  const row = admin.getByRole("row", { name: new RegExp(EMAIL) });
  await expect(row).toBeVisible();

  // the new student signs in (separate browser context) and lands on their own area
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await login(student, { email: EMAIL, password }, /\/student/);

  // deactivate: the live session loses access and a fresh sign-in is refused
  await row.getByRole("button", { name: "Deactivate" }).click();
  await expect(row.getByText("Deactivated")).toBeVisible();
  await student.goto("/student");
  await expect(student).toHaveURL(/\/login/);
  const second = await (await browser.newContext()).newPage();
  await second.goto("/login");
  await second.getByLabel("Email").fill(EMAIL);
  await second.getByLabel("Password").fill(password);
  await second.getByRole("button", { name: "Sign in" }).click();
  await expect(second.getByRole("alert").filter({ hasText: "Invalid" })).toBeVisible();

  // reactivate
  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(row.getByText("Active")).toBeVisible();
  await login(second, { email: EMAIL, password }, /\/student/);

  // students can never open the management page
  await second.goto("/admin/students");
  await expect(second).toHaveURL(/\/unauthorized/);
});
