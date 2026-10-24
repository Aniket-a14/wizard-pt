import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-surface-2 text-muted border-border",
  accent: "bg-accent-soft text-accent border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
} as const;

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium leading-none", tones[tone], className)} {...props} />
  );
}

export function DifficultyBadge({ level }: { level: string }) {
  const tone = level === "easy" ? "success" : level === "medium" ? "warning" : "danger";
  return <Badge tone={tone}>{level.charAt(0).toUpperCase() + level.slice(1)}</Badge>;
}

export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return <Badge>Pending</Badge>;
  const map: Record<string, [string, keyof typeof tones]> = {
    accepted: ["Accepted", "success"],
    partial: ["Partial", "warning"],
    wrong_answer: ["Wrong Answer", "danger"],
    compile_error: ["Compile Error", "danger"],
    runtime_error: ["Runtime Error", "danger"],
    time_limit: ["Time Limit", "danger"],
    memory_limit: ["Memory Limit", "danger"],
    system_error: ["Unavailable", "warning"],
    manual: ["Manual Review", "accent"],
  };
  const [label, tone] = map[verdict] ?? [verdict, "neutral" as const];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ReviewBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, [string, keyof typeof tones]> = {
    pending_review: ["Pending Review", "warning"],
    reviewed: ["Reviewed", "accent"],
    needs_improvement: ["Needs Improvement", "warning"],
    accepted: ["Accepted by reviewer", "success"],
    rejected: ["Rejected", "danger"],
  };
  const [label, tone] = map[status ?? "pending_review"] ?? [status ?? "", "neutral" as const];
  return <Badge tone={tone}>{label}</Badge>;
}
