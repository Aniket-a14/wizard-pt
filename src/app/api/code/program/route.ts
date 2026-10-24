import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadEvalContext } from "@/lib/coding/context";
import { composeProgram } from "@/lib/coding/compose";
import { jsonError, studentCanSeeVersion, studentOr401 } from "@/lib/coding/student-api";

const body = z.object({ versionId: z.string().uuid(), code: z.string().max(70_000) });

/**
 * The complete, runnable `Main.java` for the student's current code (platform wrapper + her code), so she
 * can run it in any external Java compiler. The wrapper only reads stdin and prints the result; it holds
 * no tests, answers or reference solution. Nothing here is executed or stored.
 */
export async function POST(req: NextRequest) {
  const user = await studentOr401();
  if (user instanceof NextResponse) return user;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.", 400);
  const { versionId, code } = parsed.data;

  if (!(await studentCanSeeVersion(versionId))) return jsonError("Problem not found.", 404);
  const ctx = await loadEvalContext(versionId);
  if (!ctx) return jsonError("Problem not found.", 404);
  return NextResponse.json({ source: composeProgram(ctx.config, code).source });
}
