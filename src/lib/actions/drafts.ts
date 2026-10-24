"use server";

import { assertStudent } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { LANGUAGES } from "@/lib/coding/languages";
import { toActionError, type ActionResult } from "./common";

const schema = z.object({ versionId: z.string().uuid(), code: z.string().max(70_000), language: z.enum(LANGUAGES).default("java") });

/** Autosave the student's work-in-progress. RLS guarantees it can only touch her own row. */
export async function saveDraft(input: { versionId: string; code: string; language?: (typeof LANGUAGES)[number] }): Promise<ActionResult<{ savedAt: string }>> {
  try {
    const user = await assertStudent();
    const p = schema.safeParse(input);
    if (!p.success) return { ok: false, error: "Invalid draft." };
    const supabase = await createClient();
    // Only versions she is allowed to see can be drafted.
    const visible = await supabase.from("question_versions").select("id").eq("id", p.data.versionId).maybeSingle();
    if (!visible.data) return { ok: false, error: "Problem not found." };
    const savedAt = new Date().toISOString();
    const { error } = await supabase.from("code_drafts").upsert({ student_id: user.id, question_version_id: p.data.versionId, language: p.data.language, source_code: p.data.code, updated_at: savedAt }, { onConflict: "student_id,question_version_id,language" });
    if (error) throw error;
    return { ok: true, savedAt };
  } catch (e) {
    return toActionError(e);
  }
}
