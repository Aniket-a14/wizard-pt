import { EmptyState, PageHeader, Panel, PanelHeader, Stat } from "@/components/ui/panel";
import { getAdminAnalytics } from "@/lib/admin/analytics";

export const metadata = { title: "Analytics" };

export default async function Analytics() {
  const a = await getAdminAnalytics();
  const max = Math.max(1, ...a.perDay.map((d) => d.submissions));
  const none = a.submittedCoding + a.submittedQuizzes === 0;
  return (
    <>
      <PageHeader title="Analytics" description="Computed live from submissions — nothing here is sample data." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Submitted (coding)" value={a.submittedCoding} />
        <Stat label="Submitted (quizzes)" value={a.submittedQuizzes} />
        <Stat label="Problems solved" value={a.acceptedProblems} />
        <Stat label="Pending reviews" value={a.pendingReviews} />
      </div>
      {none ? <div className="mt-6"><EmptyState title="No data yet">Charts appear once the student has submitted work.</EmptyState></div> : (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Panel className="lg:col-span-2">
            <PanelHeader title="Coding submissions per day (last 30 days)" />
            <div className="p-4">
              <div className="flex h-32 items-end gap-1" role="img" aria-label="Bar chart of coding submissions per day">
                {a.perDay.map((d) => (
                  <div key={d.day} className="group relative flex flex-1 flex-col justify-end" title={`${d.day}: ${d.submissions} submissions, ${d.accepted} accepted`}>
                    <div className="w-full rounded-t-sm bg-accent/30" style={{ height: `${(d.submissions / max) * 100}%` }}><div className="w-full rounded-t-sm bg-accent" style={{ height: d.submissions ? `${(d.accepted / d.submissions) * 100}%` : 0 }} /></div>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{a.perDay[0]?.day}</span><span>accepted (dark) of all submissions</span><span>{a.perDay[a.perDay.length - 1]?.day}</span></div>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Frequently failed problems" />
            {a.frequentlyFailed.length === 0 ? <p className="p-4 text-sm text-muted">No failing problems yet.</p> : (
              <table className="table-dense w-full text-sm"><thead><tr><th>Problem</th><th>Submissions</th><th>Accepted</th><th>Fail rate</th></tr></thead>
                <tbody>{a.frequentlyFailed.map((p) => (<tr key={p.title}><td>{p.title}</td><td className="tabular-nums">{p.submissions}</td><td className="tabular-nums">{p.accepted}</td><td className="tabular-nums text-danger">{Math.round(p.failRate)}%</td></tr>))}</tbody></table>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Areas of difficulty (lowest success first)" />
            {a.weakTopics.length === 0 ? <p className="p-4 text-sm text-muted">No topic data yet.</p> : (
              <table className="table-dense w-full text-sm"><thead><tr><th>Topic</th><th>Type</th><th>Success</th><th>Samples</th></tr></thead>
                <tbody>{a.weakTopics.map((t) => (<tr key={t.kind + t.topic}><td>{t.topic}</td><td className="text-muted">{t.kind === "coding" ? "Coding" : "MCQ"}</td><td className="tabular-nums">{Math.round(t.rate)}%</td><td className="tabular-nums text-muted">{t.n}</td></tr>))}</tbody></table>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
