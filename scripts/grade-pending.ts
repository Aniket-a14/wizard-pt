/**
 * Grade queued submissions on this machine (Docker sandbox) against the CLOUD database.
 *
 *   pnpm grade               grade everything waiting, then exit
 *   pnpm grade --watch       keep checking every 30 s (Ctrl+C to stop)
 *   pnpm grade --env FILE    read Supabase credentials from FILE (default: .env.cloud)
 *
 * Needs Docker running and the cloud credentials, e.g. `vercel env pull .env.cloud --environment production`.
 * Student code runs in locked-down local containers, never on the website.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const envFile = args.includes("--env") ? args[args.indexOf("--env") + 1] : ".env.cloud";
if (!existsSync(envFile)) {
  console.error(`Missing ${envFile}. Create it with:  vercel env pull ${envFile} --environment production`);
  process.exit(1);
}
config({ path: envFile, override: true });
process.env.RUNNER_PROVIDER = "docker"; // this machine is the runner, whatever the website uses
process.env.RUNNER_ALLOW_DOCKER = "1";
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.error(`${envFile} must contain NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.`);
  process.exit(1);
}
const watch = args.includes("--watch");

async function main() {
  const { gradePending } = await import("../src/lib/coding/grade-pending");
  console.log(`Grading against ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host}${watch ? " (watching, Ctrl+C to stop)" : ""}`);
  do {
    const rows = await gradePending();
    for (const r of rows) console.log(`${new Date().toLocaleTimeString()}  ${r.title}  →  ${r.verdict ?? r.status}${r.scorePct !== null ? ` (${r.scorePct}%)` : ""}  [${r.id.slice(0, 8)}]`);
    if (!watch) {
      if (rows.length === 0) console.log("Nothing waiting.");
      break;
    }
    await new Promise((r) => setTimeout(r, 30_000));
  } while (true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
