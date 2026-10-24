/**
 * Create, verify and publish one problem as the admin.
 *
 *   pnpm problem:add scripts/problems/scrambled-twin-codes.ts            publish if verified
 *   pnpm problem:add <file> --draft                                      save as a draft only
 *   pnpm problem:add <file> --env .env.cloud --accounts                  target the cloud project, signing in with .env.accounts
 *
 * Needs ADMIN_EMAIL / ADMIN_PASSWORD (the admin signs in, exactly like the UI) and Docker for the
 * verification run. The reference solution must pass EVERY test before the problem is published.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { DockerRunner } from "../src/lib/runner/docker";
import { createProblem } from "./lib/publish-problem";
import type { SeedProblem } from "./seed/problems";

const args = process.argv.slice(2);
const envIdx = args.indexOf("--env");
const envFile = envIdx >= 0 ? args[envIdx + 1] : ".env.local";
const file = args.find((a, i) => !a.startsWith("--") && i !== (envIdx >= 0 ? envIdx + 1 : -1));
if (!file) {
  console.error("Usage: pnpm problem:add <problem-file.ts> [--draft] [--env FILE]");
  process.exit(1);
}
if (existsSync(envFile)) config({ path: envFile });
if (args.includes("--accounts") && existsSync(".env.accounts")) config({ path: ".env.accounts", override: true });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!url || !pub || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY must be set.");
  if (!email || !password) throw new Error("ADMIN_EMAIL / ADMIN_PASSWORD must be set (the problem is created as the admin).");

  const problem = (await import(resolve(file!))).default as SeedProblem;
  const svc = createClient<Database>(url, secret, { auth: { persistSession: false } });
  const admin = createClient<Database>(url, pub, { auth: { persistSession: false } });
  const s = await admin.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(`Admin sign-in failed: ${s.error.message}`);

  const runner = new DockerRunner({ image: process.env.RUNNER_DOCKER_IMAGE ?? "eclipse-temurin:21-jdk", parallelism: 3 });
  const health = await runner.health();
  if (!health.ok) console.warn(`⚠ ${health.detail}\n  The problem will be saved as a draft: tests cannot be verified without the sandbox.`);

  console.log(`Target: ${new URL(url).host}`);
  const r = await createProblem({ admin, svc, runner, runnerOk: health.ok }, problem, { isSeed: false, draftOnly: args.includes("--draft") });
  console.log(r.published ? `\nPublished "${problem.title}" — the student can see it now.` : `\nSaved "${problem.title}" as a DRAFT${r.verified ? "" : " (not verified)"}.`);
  console.log(`question id: ${r.questionId}`);
  if (!r.published && !args.includes("--draft")) process.exitCode = 2;
}

main().catch((e) => {
  console.error("Failed:", e instanceof Error ? e.message : JSON.stringify(e));
  process.exit(1);
});
