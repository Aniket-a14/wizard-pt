import { Bar } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div data-skeleton aria-busy="true" aria-label="Loading" className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-2">
      <Bar className="h-full min-h-64" />
      <Bar className="h-full min-h-64" />
    </div>
  );
}
