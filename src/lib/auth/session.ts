import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "student";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Verified user + profile role, or null. The token's signature and expiry are checked locally (getClaims),
 * so the only database round trip is the profile read — which also enforces `active`, so a deactivated
 * student is locked out immediately even though their token stays valid until it expires.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const userId = claims.sub;
  const { data: profile } = await supabase.from("profiles").select("display_name, role, active").eq("id", userId).maybeSingle();
  if (!profile || !profile.active) return null; // not provisioned, or deactivated by the admin: treated as signed out
  return {
    id: userId,
    email: typeof claims.email === "string" ? claims.email : "",
    displayName: profile.display_name,
    role: profile.role as Role,
  };
});

/** For pages/layouts: redirects instead of throwing. */
export async function requireAdmin(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (u.role !== "admin") redirect("/unauthorized");
  return u;
}

export async function requireStudent(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (u.role !== "student") redirect("/unauthorized");
  return u;
}

/** For server actions / route handlers: throws AuthError (mapped to 401/403 by callers). */
export async function assertAdmin(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new AuthError(401, "Not signed in");
  if (u.role !== "admin") throw new AuthError(403, "Administrator access required");
  return u;
}

export async function assertStudent(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new AuthError(401, "Not signed in");
  if (u.role !== "student") throw new AuthError(403, "Student access required");
  return u;
}

export function homeFor(role: Role): string {
  return role === "admin" ? "/admin" : "/student";
}
