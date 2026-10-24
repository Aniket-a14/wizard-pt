/**
 * Create a coding problem as the admin, VERIFY it, and (optionally) publish it. Shared by `pnpm seed` and
 * `pnpm problem:add`, so every problem goes through the same safeguards:
 *   1. the problem is saved as a draft through the same RPC the admin UI uses;
 *   2. the reference solution is compiled and run against EVERY test in the sandbox;
 *   3. only if it is accepted is the problem published (and the student notified).
 * If the sandbox is unavailable, the problem stays a draft — unverified tests are never published.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../src/lib/supabase/database.types";
import { codingDraftSchema } from "../../src/lib/validation/question";
import { prepareCoding } from "../../src/lib/coding/prepare";
import { evaluate } from "../../src/lib/coding/evaluate";
import { parseSignature } from "../../src/lib/coding/signature";
import { buildFunctionTemplate } from "../../src/lib/coding/harness";
import type { Runner } from "../../src/lib/runner/types";
import type { CompareMode } from "../../src/lib/coding/compare";
import type { SeedProblem } from "../seed/problems";

export interface PublishContext {
  /** Signed in as the admin user (RLS + assert_admin apply, exactly like the UI). */
  admin: SupabaseClient<Database>;
  /** Service role, used only to record the validation result. */
  svc: SupabaseClient<Database>;
  runner: Runner;
  runnerOk: boolean;
}

export interface PublishResult {
  questionId: string;
  versionId: string;
  verified: boolean;
  published: boolean;
}

export async function createProblem(ctx: PublishContext, p: SeedProblem, opts: { isSeed: boolean; draftOnly: boolean }): Promise<PublishResult> {
  const { admin, svc, runner, runnerOk } = ctx;
  const customDriver = p.mode === "function" && !!p.boilerplate && !p.signature;
  const sig = p.mode === "function" && !customDriver ? parseSignature(p.signature!).declaration : "";
  const tests = [
    ...p.publicTests.map((t, i) => ({ input: t.input, expected_output: t.output, visibility: "public" as const, weight: 1, label: `Example ${i + 1}` })),
    ...p.hiddenTests.map((t) => ({ input: t.input, expected_output: t.output, visibility: "hidden" as const, weight: 1, label: t.label ?? null })),
  ];
  const draft = codingDraftSchema.parse({
    questionId: null,
    title: p.title,
    difficulty: p.difficulty,
    topic: p.topic,
    tags: p.topic.split(/\s*\+\s*/),
    company: p.company ?? "",
    marks: p.marks ?? 10,
    est_minutes: p.minutes ?? null,
    statement_md: p.statement,
    input_format: p.inputFormat,
    output_format: p.outputFormat,
    constraints_md: p.constraints,
    examples: p.examples.map((e) => ({ explanation: "", ...e })),
    config: {
      execution_mode: p.mode,
      function_signature: sig,
      starter_code: p.mode === "function" && !customDriver ? buildFunctionTemplate(parseSignature(sig)).starterMethod : "",
      compare_mode: p.compare ?? "exact",
      time_limit_ms: 2000,
      memory_limit_mb: 256,
    },
    reference_solution: p.reference,
    boilerplate_source: p.boilerplate ?? "",
    tests,
  });
  const prep = prepareCoding(draft);
  if (!prep.ok) throw new Error(`${p.title}: ${prep.error}`);
  const { data, error } = await admin.rpc("save_coding_draft", { p_payload: { ...prep.payload, is_seed: opts.isSeed } as Json });
  if (error) throw new Error(`${p.title}: ${error.message}`);
  const { question_id, version_id } = data as unknown as { question_id: string; version_id: string };

  let verified = false;
  if (runnerOk) {
    const cfg = prep.payload.config as { editable_scope: "method" | "body"; time_limit_ms: number; memory_limit_mb: number; compare_mode: CompareMode; float_tolerance: number; reveal_hidden: boolean };
    const sec = prep.payload.secrets as { template_prefix: string; template_suffix: string };
    const out = await evaluate({
      config: {
        executionMode: p.mode, editableScope: cfg.editable_scope, functionSignature: sig || null,
        templatePrefix: sec.template_prefix, templateSuffix: sec.template_suffix,
        timeLimitMs: cfg.time_limit_ms, memoryLimitMb: cfg.memory_limit_mb, compareMode: cfg.compare_mode, floatTolerance: cfg.float_tolerance, revealHidden: false,
      },
      tests: tests.map((t, i) => ({ id: String(i), input: t.input, expectedOutput: t.expected_output, visibility: t.visibility, weight: 1 })),
      studentCode: p.reference,
      runner,
    });
    const passed = out.full.filter((t) => t.status === "passed").length;
    verified = out.summary.verdict === "accepted";
    await svc.from("coding_secrets").update({ last_validation: { verdict: out.summary.verdict, passed, total: out.full.length, tests: [], compileOutput: out.compileOutput, ranAt: new Date().toISOString() } as Json }).eq("question_version_id", version_id);
    console.log(`  ${verified ? "✓" : "✗"} ${p.title}: reference passes ${passed}/${out.full.length}`);
    if (!verified) {
      console.error(out.compileOutput ? `    compile output: ${out.compileOutput}` : "");
      console.error(out.full.filter((t) => t.status !== "passed").map((t) => `    test ${t.testId}: ${t.status} ${t.message ?? ""}`).join("\n"));
    }
  }

  let published = false;
  if (verified && !opts.draftOnly) {
    const pub = await admin.rpc("publish_coding_question", { p_question_id: question_id });
    if (pub.error) throw new Error(`${p.title}: ${pub.error.message}`);
    published = true;
  }
  return { questionId: question_id, versionId: version_id, verified, published };
}
