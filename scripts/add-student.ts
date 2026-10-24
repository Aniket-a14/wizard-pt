/**
 * Add one student account (the admin can also do this on the Students page).
 *
 *   pnpm student:add "Priya Sharma" priya@example.com                 generates a password and prints it once
 *   pnpm student:add "Priya Sharma" priya@example.com 'Pa55word123'   uses the password you give
 *   pnpm student:add … --env .env.cloud                               target the cloud project (default: .env.local)
 *
 * Passwords need 10+ characters with lower-case, upper-case and digits. Public sign-up stays disabled.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { createStudent } from "../src/lib/students/provision";

const args = process.argv.slice(2);
const envIdx = args.indexOf("--env");
const envFile = envIdx >= 0 ? args[envIdx + 1] : ".env.local";
const [name, email, password] = args.filter((a, i) => !a.startsWith("--") && i !== (envIdx >= 0 ? envIdx + 1 : -1));
if (!name || !email) {
  console.error('Usage: pnpm student:add "Full Name" email [password] [--env FILE]');
  process.exit(1);
}
if (existsSync(envFile)) config({ path: envFile });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
  const db = createClient<Database>(url, key, { auth: { persistSession: false } });
  const r = await createStudent(db, { name, email, password });
  console.log(`Created student ${name} <${r.email}>\nPassword: ${r.password}\n(shown once — share it, then ask them to change it under Settings)`);
}

main().catch((e) => {
  console.error("Could not add the student:", e.message ?? e);
  process.exit(1);
});
