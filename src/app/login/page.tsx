import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/utils";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "";
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="font-mono text-sm font-semibold tracking-tight">{APP_NAME}</div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Private practice platform. Accounts are created by the administrator.</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
