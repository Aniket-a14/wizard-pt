/**
 * Provision the two accounts (admin + student). Idempotent.
 *
 * Credentials come from the environment (or an interactive prompt) — nothing is hardcoded or
 * committed. Public sign-up is disabled in Supabase; this script uses the service-role key.
 *
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… STUDENT_EMAIL=… STUDENT_PASSWORD=… pnpm bootstrap
 */
import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

async function ask(name: string, label: string, secret = false): Promise<string> {
  const existing = process.env[name]?.trim();
  if (existing) return existing;
  if (!process.stdin.isTTY) throw new Error(`${name} is not set (and there is no terminal to ask).`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const v = (await rl.question(`${label}${secret ? " (input visible)" : ""}: `)).trim();
  rl.close();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const users = [
    { role: "admin" as const, email: await ask("ADMIN_EMAIL", "Admin email"), password: await ask("ADMIN_PASSWORD", "Admin password", true), name: process.env.ADMIN_NAME || "Admin" },
    { role: "student" as const, email: await ask("STUDENT_EMAIL", "Student email"), password: await ask("STUDENT_PASSWORD", "Student password", true), name: process.env.STUDENT_NAME || "Student" },
  ];

  for (const u of users) {
    if (u.password.length < 8) throw new Error(`${u.role} password must be at least 8 characters`);
    const email = u.email.toLowerCase();
    let id: string | undefined;
    const created = await supabase.auth.admin.createUser({ email, password: u.password, email_confirm: true, user_metadata: { display_name: u.name } });
    if (created.error) {
      if (!/already|registered|exists/i.test(created.error.message)) throw created.error;
      // Already exists: find it and reset the password to the supplied one.
      let page = 1;
      while (!id) {
        const list = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        if (list.error) throw list.error;
        id = list.data.users.find((x) => x.email?.toLowerCase() === email)?.id;
        if (list.data.users.length < 200) break;
        page++;
      }
      if (!id) throw new Error(`Could not locate existing user ${email}`);
      const upd = await supabase.auth.admin.updateUserById(id, { password: u.password, email_confirm: true });
      if (upd.error) throw upd.error;
      console.log(`• ${u.role}: ${email} already existed — password updated`);
    } else {
      id = created.data.user.id;
      console.log(`• ${u.role}: ${email} created`);
    }
    const { error } = await supabase.from("profiles").upsert({ id, display_name: u.name, role: u.role });
    if (error) throw error;
  }
  console.log("\nDone. Remove the credentials from your shell/.env when finished.");
}

main().catch((e) => {
  console.error("Bootstrap failed:", e.message ?? e);
  process.exit(1);
});
