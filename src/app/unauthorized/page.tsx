import Link from "next/link";
import { getSessionUser, homeFor } from "@/lib/auth/session";

export const metadata = { title: "Not allowed" };

export default async function Unauthorized() {
  const user = await getSessionUser();
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <div className="font-mono text-4xl font-semibold">403</div>
        <h1 className="mt-2 text-lg font-semibold">You don&apos;t have access to that page</h1>
        <p className="mt-1 text-sm text-muted">This area is restricted to a different role.</p>
        <Link href={user ? homeFor(user.role) : "/login"} className="mt-4 inline-block text-sm text-accent underline">
          {user ? "Back to your dashboard" : "Go to sign in"}
        </Link>
      </div>
    </main>
  );
}
