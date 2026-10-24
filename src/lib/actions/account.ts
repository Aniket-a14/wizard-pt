"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toActionError, type ActionResult } from "./common";

export async function updateDisplayName(name: string): Promise<ActionResult> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: "Not signed in" };
    const p = z.string().trim().min(1, "Enter a name").max(80).safeParse(name);
    if (!p.success) return { ok: false, error: p.error.issues[0].message };
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update({ display_name: p.data }).eq("id", user.id);
    if (error) throw error;
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function changePassword(newPassword: string): Promise<ActionResult> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: "Not signed in" };
    const p = z.string().min(8, "Use at least 8 characters").max(200).safeParse(newPassword);
    if (!p.success) return { ok: false, error: p.error.issues[0].message };
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: p.data });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
