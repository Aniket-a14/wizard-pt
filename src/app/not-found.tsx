import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-24">
      <div className="max-w-sm text-center">
        <div className="font-mono text-4xl font-semibold">404</div>
        <h1 className="mt-2 text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">It may have been unpublished, archived, or never existed.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
