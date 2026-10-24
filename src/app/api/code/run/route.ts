import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadEvalContext, type EvalContext } from "@/lib/coding/context";
import { LANGUAGES } from "@/lib/coding/languages";
import { CodeValidationError } from "@/lib/coding/compose";
import { evaluate, evaluateCustom } from "@/lib/coding/evaluate";
import { getRunner } from "@/lib/runner";
import { isExternalRunnerMode } from "@/lib/runner/mode";
import { jsonError, runnerErrorResponse, studentCanSeeVersion, studentOr401 } from "@/lib/coding/student-api";

export const maxDuration = 60;

const body = z.object({
  versionId: z.string().uuid(),
  code: z.string().max(70_000),
  customInput: z.string().max(100_000).optional(),
  language: z.enum(LANGUAGES).default("java"),
});

const RUNS_PER_MINUTE = 8;

export async function POST(req: NextRequest) {
  const user = await studentOr401();
  if (user instanceof NextResponse) return user;

  if (isExternalRunnerMode()) return jsonError("Running code is not available on this site. Copy the program into an online compiler, then submit it for review.", 409);

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400);
  const { versionId, code, customInput, language } = parsed.data;

  if (!(await studentCanSeeVersion(versionId))) return jsonError("Problem not found.", 404);

  const db = createAdminClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await db.from("code_runs").select("id", { count: "exact", head: true }).eq("student_id", user.id).gte("created_at", since);
  if ((recent.count ?? 0) >= RUNS_PER_MINUTE) return jsonError("You're running code too quickly. Wait a few seconds and try again.", 429);

  let ctx: EvalContext | null;
  try {
    ctx = await loadEvalContext(versionId, language);
  } catch (e) {
    return runnerErrorResponse(e);
  }
  if (!ctx) return jsonError("Problem not found.", 404);

  try {
    const runner = getRunner();
    const publicTests = ctx.tests.filter((t) => t.visibility === "public");
    let custom = null;
    let result = null;
    if (customInput !== undefined && customInput !== "") {
      if (!ctx.allowCustomInput) return jsonError("Custom input is not enabled for this problem.", 400);
      custom = await evaluateCustom({ config: ctx.config, input: customInput, studentCode: code, runner });
      if (custom.systemError) return runnerErrorResponse(new (await import("@/lib/runner/types")).RunnerUnavailableError(custom.systemError));
    } else {
      if (publicTests.length === 0) return jsonError("This problem has no sample tests to run. Use Submit, or provide custom input.", 400);
      const out = await evaluate({ config: ctx.config, tests: publicTests, studentCode: code, runner });
      if (out.systemError) return runnerErrorResponse(new (await import("@/lib/runner/types")).RunnerUnavailableError(out.systemError));
      result = {
        verdict: out.summary.verdict,
        passed: out.summary.passedPublic,
        total: out.summary.totalPublic,
        compileOutput: out.compileOutput,
        execTimeMs: out.execTimeMs,
        memoryKb: out.memoryKb,
        // Only public tests were executed, but strip anything non-public defensively.
        results: out.student.filter((r) => r.visibility === "public"),
      };
    }
    await db.from("code_runs").insert({ student_id: user.id, question_version_id: versionId, source_code: code, verdict: result?.verdict ?? custom?.status ?? null });
    return NextResponse.json({ mode: custom ? "custom" : "public", result, custom });
  } catch (e) {
    if (e instanceof CodeValidationError) return jsonError(e.message, 400);
    return runnerErrorResponse(e);
  }
}
