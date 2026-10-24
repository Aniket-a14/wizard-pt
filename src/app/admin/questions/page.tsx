import Link from "next/link";
import { Badge, DifficultyBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Question bank" };

const STATUS_TONE = { draft: "neutral", published: "success", archived: "warning" } as const;

export default async function QuestionBank({ searchParams }: PageProps<"/admin/questions">) {
  const sp = await searchParams;
  const type = typeof sp.type === "string" ? sp.type : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("questions")
    .select("id, seq, type, status, updated_at, published_version_id, is_seed, current:question_versions!questions_current_version_fk(id, version, title, difficulty, topic, tags, company, published_at)")
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? [])
    .filter((r) => (!type || r.type === type) && (!status || r.status === status))
    .filter((r) => !q || [r.current?.title, r.current?.topic, r.current?.company, ...(r.current?.tags ?? [])].join(" ").toLowerCase().includes(q));

  const chip = (label: string, href: string, active: boolean) => (
    <Link href={href} className={cn("rounded-full border px-2.5 py-0.5 text-xs", active ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:bg-surface-2")}>
      {label}
    </Link>
  );
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(type && { type }), ...(status && { status }), ...(q && { q }), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const s = p.toString();
    return `/admin/questions${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Question bank"
        description="Coding problems and MCQs. Drafts stay private until you publish."
        actions={
          <>
            <Link href="/admin/questions/new/coding" className={buttonVariants({ variant: "primary" })}>New coding problem</Link>
            <Link href="/admin/questions/new/mcq" className={buttonVariants()}>New MCQ</Link>
            <Link href="/admin/import" className={buttonVariants()}>Import / paste</Link>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form className="mr-2" action="/admin/questions">
          {type && <input type="hidden" name="type" value={type} />}
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q} placeholder="Search title, topic, company…" aria-label="Search questions" className="h-8 w-64 rounded-md border border-border-strong bg-surface px-2.5 text-sm" />
        </form>
        {chip("All types", href({ type: "" }), !type)}
        {chip("Coding", href({ type: "coding" }), type === "coding")}
        {chip("MCQ", href({ type: "mcq" }), type === "mcq")}
        <span className="mx-1 text-border-strong">|</span>
        {chip("Any status", href({ status: "" }), !status)}
        {chip("Draft", href({ status: "draft" }), status === "draft")}
        {chip("Published", href({ status: "published" }), status === "published")}
        {chip("Archived", href({ status: "archived" }), status === "archived")}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No questions match">Create a problem, paste questions, or upload a PDF to get started.</EmptyState>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="table-dense w-full text-sm">
            <thead>
              <tr>
                <th>ID</th><th>Title</th><th>Type</th><th>Difficulty</th><th>Topic</th><th>Status</th><th>Version</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = r.current;
                const pendingDraft = r.status === "published" && v && !v.published_at;
                return (
                  <tr key={r.id}>
                    <td className="font-mono text-xs text-muted">{r.type === "coding" ? "P" : "Q"}-{r.seq}</td>
                    <td>
                      <Link href={`/admin/questions/${r.id}`} className="font-medium hover:text-accent hover:underline">{v?.title ?? "(untitled)"}</Link>
                      {r.is_seed && <Badge className="ml-2">seed</Badge>}
                      {v?.company && <span className="ml-2 text-xs text-muted">{v.company}</span>}
                    </td>
                    <td>{r.type === "coding" ? "Coding" : "MCQ"}</td>
                    <td>{v ? <DifficultyBadge level={v.difficulty} /> : "—"}</td>
                    <td className="text-muted">{v?.topic ?? "—"}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE]}>{r.status}</Badge>
                      {pendingDraft && <Badge tone="warning" className="ml-1">unpublished edits</Badge>}
                    </td>
                    <td className="tabular-nums text-muted">v{v?.version ?? 1}</td>
                    <td className="text-muted">{formatDateTime(r.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
