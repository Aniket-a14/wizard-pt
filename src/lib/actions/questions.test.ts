import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ signature: null as string | null, publish: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ assertAdmin: async () => ({ id: "admin" }), AuthError: class extends Error {} }));
vi.mock("next/cache", () => ({ revalidatePath() {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    const result = { data: table === "questions" ? { current_version_id: "version" }
      : table === "coding_configs" ? { execution_mode: "function", grading_mode: "auto", function_signature: mocks.signature }
      : [{ input: "push 1", visibility: "public" }], error: null };
    const query = { select: () => query, eq: () => query, single: async () => result, maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  },
  rpc: mocks.publish,
}) }));
import { publishCodingQuestion } from "./questions";
beforeEach(() => { mocks.publish.mockReset().mockResolvedValue({ error: null }); });
it("publishes a custom driver without trying to parse a missing signature", async () => {
  mocks.signature = null;
  expect(await publishCodingQuestion("problem")).toEqual({ ok: true });
  expect(mocks.publish).toHaveBeenCalledWith("publish_coding_question", { p_question_id: "problem" });
});
it("still blocks malformed typed function configurations", async () => {
  mocks.signature = "not a method signature";
  expect((await publishCodingQuestion("problem")).ok).toBe(false);
  expect(mocks.publish).not.toHaveBeenCalled();
});
