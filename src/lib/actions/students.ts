"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStudent, resetStudentPassword, setStudentActive, StudentError } from "@/lib/students/provision";
import { toActionError, type ActionResult } from "./common";

const email = z.string().trim().toLowerCase().email("Enter a valid email").max(200);
const name = z.string().trim().min(1, "Enter a name").max(80);
const id = z.string().uuid();

function fail(e: unknown) {
  if (e instanceof StudentError) return { ok: false as const, error: e.message };
  return toActionError(e);
}

/** Creates the account and returns the password ONCE (it is never stored in readable form). */
export async function addStudent(input: { name: string; email: string; password?: string }): Promise<ActionResult<{ email: string; password: string }>> {
  try {
    await assertAdmin();
    const p = z.object({ name, email, password: z.string().max(200).optional() }).safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0].message };
    const r = await createStudent(createAdminClient(), { ...p.data, password: p.data.password?.trim() || undefined });
    revalidatePath("/admin/students");
    return { ok: true, email: r.email, password: r.password };
  } catch (e) {
    return fail(e);
  }
}

export async function resetStudentPasswordAction(studentId: string): Promise<ActionResult<{ password: string }>> {
  try {
    await assertAdmin();
    const r = await resetStudentPassword(createAdminClient(), id.parse(studentId));
    return { ok: true, password: r.password };
  } catch (e) {
    return fail(e);
  }
}

export async function setStudentActiveAction(studentId: string, active: boolean): Promise<ActionResult> {
  try {
    await assertAdmin();
    await setStudentActive(createAdminClient(), id.parse(studentId), active);
    revalidatePath("/admin/students");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
