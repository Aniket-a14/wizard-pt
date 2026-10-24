import { cn } from "@/lib/utils";

const base =
  "w-full rounded-md border border-border-strong bg-surface px-2.5 text-sm placeholder:text-muted/70 disabled:opacity-60 focus-visible:outline-accent";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "py-1.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(base, "h-8 pr-6", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted">{hint}</span>}
      {error && <span className="block text-xs text-danger">{error}</span>}
    </label>
  );
}
