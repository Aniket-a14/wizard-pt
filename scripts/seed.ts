/**
 * Seed demo content (clearly marked `is_seed`, fully removable).
 *
 *   pnpm seed            create + publish the demo problems and quiz (needs Docker for verification)
 *   pnpm seed --draft    create everything as drafts (nothing is published / no notifications)
 *   pnpm seed:remove     delete all seed content, including any work done on it
 *
 * Reference solutions are executed against every test in the sandbox before a problem is published.
 * If the sandbox is unavailable the problems are left as DRAFTS — unverified tests are never published.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/lib/supabase/database.types";
import { DockerRunner } from "../src/lib/runner/docker";
import { MCQS, PROBLEMS } from "./seed/problems";
import { createProblem } from "./lib/publish-problem";

config({ path: ".env.local" });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;

async function remove() {
  const db = createClient<Database>(url, secret, { auth: { persistSession: false } });
  const qs = await db.from("questions").select("id").eq("is_seed", true);
  const qids = (qs.data ?? []).map((q) => q.id);
  const as = await db.from("assessments").select("id").eq("is_seed", true);
  const aids = (as.data ?? []).map((a) => a.id);
  if (qids.length === 0 && aids.length === 0) return console.log("No seed content found.");

  const vs = qids.length ? await db.from("question_versions").select("id").in("question_id", qids) : { data: [] as { id: string }[] };
  const vids = (vs.data ?? []).map((v) => v.id);

  if (vids.length) {
    const subs = await db.from("code_submissions").select("id").in("question_version_id", vids);
    const sids = (subs.data ?? []).map((s) => s.id);
    if (sids.length) await db.from("reviews").delete().in("code_submission_id", sids);
    await db.from("code_submissions").delete().in("question_version_id", vids);
    await db.from("code_runs").delete().in("question_version_id", vids);
  }
  // Quizzes that include seed questions are removed too (a seed question can't outlive its quiz).
  const viaQuestions = vids.length ? await db.from("assessment_questions").select("assessment_id").in("question_version_id", vids) : { data: [] as { assessment_id: string }[] };
  const allAids = [...new Set([...aids, ...(viaQuestions.data ?? []).map((a) => a.assessment_id)])];
  for (const aid of allAids) {
    const att = await db.from("assessment_attempts").select("id").eq("assessment_id", aid);
    const ids = (att.data ?? []).map((a) => a.id);
    if (ids.length) await db.from("reviews").delete().in("attempt_id", ids);
    await db.from("assessment_attempts").delete().eq("assessment_id", aid);
    await db.from("assessment_questions").delete().eq("assessment_id", aid);
    await db.from("assessments").delete().eq("id", aid);
  }
  if (qids.length) {
    await db.from("questions").update({ current_version_id: null, published_version_id: null }).in("id", qids);
    const del = await db.from("questions").delete().in("id", qids);
    if (del.error) throw del.error;
  }
  console.log(`Removed ${qids.length} seed questions and ${allAids.length} quizzes.`);
}

async function seed(asDraft: boolean) {
  const svc = createClient<Database>(url, secret, { auth: { persistSession: false } });
  const existing = await svc.from("questions").select("id", { count: "exact", head: true }).eq("is_seed", true);
  if ((existing.count ?? 0) > 0) throw new Error("Seed content already exists. Run `pnpm seed:remove` first.");

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_EMAIL / ADMIN_PASSWORD must be set (the seed runs as the admin user).");
  const admin = createClient<Database>(url, pub, { auth: { persistSession: false } });
  const s = await admin.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(`Admin sign-in failed: ${s.error.message}`);

  const runner = new DockerRunner({ image: process.env.RUNNER_DOCKER_IMAGE ?? "eclipse-temurin:21-jdk", parallelism: 3 });
  const runnerHealth = await runner.health();
  if (!runnerHealth.ok) console.warn(`⚠ ${runnerHealth.detail}\n  Problems will be created as drafts (tests cannot be verified without the sandbox).`);

  let published = 0;
  for (const p of PROBLEMS) {
    const r = await createProblem({ admin, svc, runner, runnerOk: runnerHealth.ok }, p, { isSeed: true, draftOnly: asDraft });
    if (r.published) published++;
  }

  // MCQ bank + a sample quiz
  const mcqIds: string[] = [];
  for (const m of MCQS) {
    const { data, error } = await admin.rpc("save_mcq_draft", {
      p_payload: {
        title: m.question.slice(0, 90), difficulty: m.difficulty, topic: m.topic, tags: [m.topic], company: m.company ?? "",
        statement_md: m.question, code_snippet: m.code ?? "", marks: 1, mcq_multi: m.correct.length > 1, explanation_md: m.explanation, is_seed: true,
        options: m.options.map((text, i) => ({ text, correct: m.correct.includes(i) })),
      } as Json,
    });
    if (error) throw new Error(`MCQ "${m.question}": ${error.message}`);
    mcqIds.push((data as unknown as { question_id: string }).question_id);
  }
  const quiz = await admin.rpc("save_quiz_draft", {
    p_payload: {
      title: "Placement Basics — Sample Quiz",
      description: "Eight quick questions on data structures, algorithms, Java and SQL.",
      is_seed: true,
      settings: { timer_minutes: 15, max_attempts: 3, negative_marking: { enabled: true, penalty_fraction: 0.25 }, partial_multi: false, shuffle_questions: false, shuffle_options: false, show_score: "immediately", show_answers: "after_release" },
      questions: mcqIds.map((id) => ({ question_id: id, marks: 1 })),
    } as Json,
  });
  if (quiz.error) throw new Error(`Quiz: ${quiz.error.message}`);
  if (!asDraft) {
    const pq = await admin.rpc("publish_assessment", { p_assessment_id: quiz.data as string });
    if (pq.error) throw new Error(`Quiz publish: ${pq.error.message}`);
  }
  console.log(`\nSeeded ${PROBLEMS.length} coding problems (${published} published), ${MCQS.length} MCQs and 1 quiz${asDraft ? " (all drafts)" : ""}.`);
  console.log("Remove with: pnpm seed:remove");
}

async function main() {
  if (process.argv.includes("--remove")) return remove();
  try {
    await seed(process.argv.includes("--draft"));
  } catch (e) {
    // Don't leave a half-seeded database behind.
    console.error("Seed failed — rolling back partial seed content…");
    await remove().catch(() => undefined);
    throw e;
  }
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : JSON.stringify(e));
  process.exit(1);
});
