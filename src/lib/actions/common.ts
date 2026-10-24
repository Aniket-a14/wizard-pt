import "server-only";
import { AuthError } from "@/lib/auth/session";
import { RunnerUnavailableError } from "@/lib/runner/types";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Map thrown errors to a safe message. Our own `raise exception` messages (P0001) are shown; anything else is logged and hidden. */
export function toActionError(e: unknown): { ok: false; error: string } {
  if (e instanceof AuthError) return { ok: false, error: e.message };
  if (e instanceof RunnerUnavailableError) return { ok: false, error: `The code runner is not available: ${e.message}` };
  const err = e as { code?: string; message?: string; name?: string };
  if (err?.name === "ZodError") return { ok: false, error: "Some fields are invalid." };
  if (err?.code === "P0001" || err?.code === "42501") return { ok: false, error: String(err.message ?? "Not allowed") };
  if (err?.code === "23503") return { ok: false, error: "This item is referenced by other records (submissions, quizzes). Archive it instead of deleting." };
  console.error("[action error]", e);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path.map(String).join(".");
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}
