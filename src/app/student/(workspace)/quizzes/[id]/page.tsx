import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge, ReviewBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/panel";
import { requireStudent } from "@/lib/auth/session";
import { QuizError, loadAttemptSession, getAttemptResult } from "@/lib/quiz/server";
import { parseQuizSettings } from "@/lib/mcq/settings";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { QuizRunner } from "./quiz-runner";
import { StartQuiz } from "./start-quiz";
import { ResultView } from "./result-view";

export const metadata = { title: "Quiz" };

export default async function QuizPage({ params, searchParams }: PageProps<"/student/quizzes/[id]">) {
  const user = await requireStudent();
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const a = await supabase.from("assessments").select("id, title, description, status, settings, assessment_questions(marks)").eq("id", id).maybeSingle();
  if (!a.data) notFound();
  const settings = parseQuizSettings(a.data.settings);

  const db = createAdminClient();
  const { data: attempts } = await db.from("assessment_attempts").select("id, status, attempt_no, started_at, submitted_at, deadline_at").eq("assessment_id", id).eq("student_id", user.id).order("attempt_no", { ascending: false });
  const open = attempts?.find((t) => t.status === "in_progress");

  // A specific submitted attempt was requested → results.
  if (typeof sp.attempt === "string" && z.string().uuid().safeParse(sp.attempt).success) {
    const result = await getAttemptResult(sp.attempt, user.id).catch((e) => {
      if (!(e instanceof QuizError)) throw e;
      return null;
    });
    if (result) return <div className="mx-auto w-full max-w-4xl px-4 py-6"><ResultView result={result} assessmentId={id} /></div>;
  }

  if (open) {
    // If the timer had expired the attempt was auto-submitted: fall through to the intro/results listing.
    const session = await loadAttemptSession(open.id, user.id).catch((e) => {
      if (!(e instanceof QuizError)) throw e;
      return null;
    });
    if (session) return <QuizRunner session={session} />;
  }

  const fresh = (await db.from("assessment_attempts").select("id, status, attempt_no, started_at, submitted_at, auto_submitted, score, max_score").eq("assessment_id", id).eq("student_id", user.id).order("attempt_no", { ascending: false })).data ?? [];
  const submitted = fresh.filter((t) => t.status === "submitted");
  const left = settings.max_attempts - fresh.length;
  const totalMarks = a.data.assessment_questions.reduce((s, q) => s + Number(q.marks), 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader title={a.data.title} description={a.data.description ?? undefined} />
      <Panel className="space-y-4 p-5">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted">Questions</dt><dd className="font-semibold">{a.data.assessment_questions.length}</dd></div>
          <div><dt className="text-xs text-muted">Total marks</dt><dd className="font-semibold">{totalMarks}</dd></div>
          <div><dt className="text-xs text-muted">Time limit</dt><dd className="font-semibold">{settings.timer_minutes ? `${settings.timer_minutes} min` : "None"}</dd></div>
          <div><dt className="text-xs text-muted">Attempts left</dt><dd className="font-semibold">{Math.max(0, left)} of {settings.max_attempts}</dd></div>
        </dl>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {settings.negative_marking.enabled && <li>Negative marking: a wrong answer loses {Math.round(settings.negative_marking.penalty_fraction * 100)}% of that question&apos;s marks. Unanswered questions are not penalised.</li>}
          {settings.timer_minutes && <li>The timer starts when you press Start and the quiz is submitted automatically when it ends.</li>}
          <li>Your answers are saved automatically. You can refresh or come back and resume.</li>
        </ul>
        {a.data.status === "published" && left > 0 ? <StartQuiz assessmentId={id} resume={false} /> : <p className="text-sm text-muted">{a.data.status !== "published" ? "This quiz is closed." : "You have used all attempts."}</p>}
      </Panel>
      {submitted.length > 0 && (
        <Panel className="mt-5">
          <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">Your attempts</div>
          <ul className="divide-y divide-border text-sm">
            {submitted.map((t) => (
              <li key={t.id}>
                <Link href={`/student/quizzes/${id}?attempt=${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <span>Attempt {t.attempt_no}</span>
                  {t.auto_submitted && <Badge>auto-submitted</Badge>}
                  <span className="ml-auto text-xs text-muted">{formatDateTime(t.submitted_at)}</span>
                  <span className={buttonVariants({ size: "sm" })}>View result</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <p className="sr-only"><ReviewBadge status={null} /></p>
    </div>
  );
}
