"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { homeFor, type Role } from "./session";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password").max(200),
});

export interface LoginState {
  error: string | null;
}

function safeNext(next: string | null | undefined, role: Role): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
    if (role === "admin" && next.startsWith("/admin")) return next;
    if (role === "student" && next.startsWith("/student")) return next;
  }
  return homeFor(role);
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { error: "Invalid email or password." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return { error: "This account has not been set up for the platform. Contact the administrator." };
  }
  redirect(safeNext(String(formData.get("next") ?? ""), profile.role as Role));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
