import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadEvalContext, type EvalContext } from "@/lib/coding/context";
import { LANGUAGES, LANG_META } from "@/lib/coding/languages";
import { composeProgram } from "@/lib/coding/compose";
import { jsonError, runnerErrorResponse, studentCanSeeVersion, studentOr401 } from "@/lib/coding/student-api";

const body = z.object({ versionId: z.string().uuid(), code: z.string().max(70_000), language: z.enum(LANGUAGES).default("java") });

/**
 * The complete, runnable program (Main.java / main.cpp / main.c) for the student's current code (platform wrapper + her code), so she
 * can run it in any external compiler. The wrapper only reads stdin and prints the result; it holds
 * no tests, answers or reference solution. Nothing here is executed or stored.
 */
export async function POST(req: NextRequest) {
  const user = await studentOr401();
  if (user instanceof NextResponse) return user;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400);
  const { versionId, code, language } = parsed.data;

  if (!(await studentCanSeeVersion(versionId))) return jsonError("Problem not found.", 404);
  let ctx: EvalContext | null;
  try {
    ctx = await loadEvalContext(versionId, language);
  } catch (e) {
    return runnerErrorResponse(e);
  }
  if (!ctx) return jsonError("Problem not found.", 404);
  return NextResponse.json({ source: composeProgram(ctx.config, code).source, fileName: LANG_META[language].file });
}
