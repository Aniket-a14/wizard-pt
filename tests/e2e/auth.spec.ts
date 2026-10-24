import { expect, test } from "@playwright/test";
import { ADMIN, STUDENT, login } from "./helpers";

test("unauthenticated visitors are sent to login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await page.goto("/student/assessments");
  await expect(page).toHaveURL(/\/login/);
  const api = await page.request.post("/api/code/run", { data: {} });
  expect(api.status()).toBe(401);
});

test("wrong password is rejected without revealing which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(STUDENT.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid" })).toHaveText("Invalid email or password.");
});

test("student cannot open admin pages or admin-only APIs", async ({ page }) => {
  await login(page, STUDENT, /\/student/);
  for (const path of ["/admin", "/admin/questions", "/admin/submissions", "/admin/questions/new/coding"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/unauthorized/);
  }
  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(403);
});

test("admin cannot open student workspace; role sends each user to their own home", async ({ page }) => {
  await login(page, ADMIN, /\/admin/);
  await page.goto("/student");
  await expect(page).toHaveURL(/\/unauthorized/);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/admin/);
});

test("unknown pages show the 404 page", async ({ page }) => {
  await login(page, STUDENT, /\/student/);
  await page.goto("/student/problems/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("Page not found")).toBeVisible();
});
