import { cn } from "@/lib/utils";

export function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

/**
 * Instant placeholder shown while a page's data loads (the route's `loading.tsx`). It lets Next.js
 * prefetch the page shell, so clicking a link responds immediately instead of waiting on the server.
 * Deliberately has no <h1>, so "page ready" checks still wait for the real page.
 */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading" className={cn("space-y-5", className)}>
      <div className="space-y-2">
        <Bar className="h-6 w-48" />
        <Bar className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Bar key={i} className="h-20" />)}
      </div>
      <Bar className="h-64" />
    </div>
  );
}
