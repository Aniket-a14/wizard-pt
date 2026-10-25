"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { saveQuizAnswer, submitQuizAttempt } from "@/lib/actions/student-quiz";
import type { AttemptSession } from "@/lib/quiz/server";
import { cn } from "@/lib/utils";

type Ans = { selected: string[]; marked: boolean };

export function QuizRunner({ session }: { session: AttemptSession }) {
  const router = useRouter();
  const qs = session.questions;
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Ans>>(session.answers);
  const [sync, setSync] = useState<"saved" | "saving" | "offline">("saved");
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [offset] = useState(() => Date.parse(session.serverNow) - Date.now());
  const dirty = useRef(new Map<string, Ans>());
  const flushing = useRef<Promise<boolean> | null>(null);
  const answersRef = useRef(session.answers);
  const submittedRef = useRef(false);

  const flush = useCallback((): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    const save = async () => {
      while (dirty.current.size > 0) {
        const [vid, a] = dirty.current.entries().next().value as [string, Ans];
        setSync("saving");
        let ok = false;
        for (let attempt = 0; attempt < 6 && !ok; attempt++) {
          try {
            const r = await saveQuizAnswer({ attemptId: session.attemptId, versionId: vid, selected: a.selected, marked: a.marked });
            if (r.ok) ok = true;
            else if (/Time is up|already been submitted/i.test(r.error)) { dirty.current.clear(); router.refresh(); return false; }
            else throw new Error(r.error);
          } catch {
            setSync("offline");
            await new Promise((res) => setTimeout(res, Math.min(8000, 800 * 2 ** attempt)));
          }
        }
        if (!ok) return false; // still offline; the next change (or online event) retries
        if (dirty.current.get(vid) === a) dirty.current.delete(vid);
      }
      setSync("saved");
      return true;
    };
    flushing.current = save().finally(() => { flushing.current = null; });
    return flushing.current;
  }, [session.attemptId, router]);

  useEffect(() => {
    const online = () => void flush();
    window.addEventListener("online", online);
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current.size > 0) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("online", online); window.removeEventListener("beforeunload", warn); };
  }, [flush]);

  function update(vid: string, patch: Partial<Ans>) {
    if (submittedRef.current) return;
    const next: Ans = { ...(answersRef.current[vid] ?? { selected: [], marked: false }), ...patch };
    answersRef.current = { ...answersRef.current, [vid]: next };
    dirty.current.set(vid, next);
    setAnswers(answersRef.current);
    void Promise.resolve().then(flush);
  }

  const doSubmit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      if (!(await flush())) {
        toast.error("Your latest answers are not saved yet. Check your connection and try submitting again.");
        return;
      }
      const r = await submitQuizAttempt(session.attemptId);
      if (!r.ok) return void toast.error(r.error);
      router.replace(`/student/quizzes/${session.assessmentId}?attempt=${session.attemptId}`);
      router.refresh();
    } catch {
      toast.error("Could not submit. Your saved answers are kept — please try again.");
    } finally {
      submittedRef.current = false;
      setSubmitting(false);
    }
  }, [flush, router, session.assessmentId, session.attemptId]);

  // Countdown (uses server time offset so a wrong device clock can't extend the quiz).
  useEffect(() => {
    if (!session.deadlineAt) return;
    const deadline = Date.parse(session.deadlineAt);
    const tick = () => {
      const left = deadline - (Date.now() + offset);
      setRemaining(Math.max(0, left));
      if (left <= 0) void doSubmit();
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [session.deadlineAt, doSubmit, offset]);

  const q = qs[idx];
  const cur = answers[q?.versionId] ?? { selected: [], marked: false };
  const answered = useMemo(() => qs.filter((x) => (answers[x.versionId]?.selected.length ?? 0) > 0).length, [qs, answers]);
  const marked = useMemo(() => qs.filter((x) => answers[x.versionId]?.marked).length, [qs, answers]);

  if (!q) return <p className="p-6 text-sm text-muted">This quiz has no questions.</p>;

  const mm = remaining === null ? null : `${String(Math.floor(remaining / 60000)).padStart(2, "0")}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 gap-5 px-4 py-5 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-3 lg:sticky lg:top-16 lg:self-start">
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="text-sm font-semibold">{session.title}</div>
          {mm && <div className={cn("mt-1 font-mono text-xl tabular-nums", remaining! < 60_000 ? "text-danger" : "")} role="timer" aria-live="off">{mm}</div>}
          <div className="mt-1 text-xs text-muted">{answered}/{qs.length} answered · {marked} marked</div>
          <div className="mt-1 text-xs" aria-live="polite">{sync === "saved" ? <span className="text-muted">All answers saved</span> : sync === "saving" ? <span className="text-muted">Saving…</span> : <span className="text-warning">Offline — will retry</span>}</div>
        </div>
        <nav aria-label="Question navigator" className="grid grid-cols-5 gap-1.5 rounded-lg border border-border bg-surface p-3">
          {qs.map((x, i) => {
            const a = answers[x.versionId];
            const isAns = (a?.selected.length ?? 0) > 0;
            return (
              <button key={x.versionId} onClick={() => setIdx(i)} aria-label={`Question ${i + 1}${isAns ? ", answered" : ", unanswered"}${a?.marked ? ", marked for review" : ""}`} aria-current={i === idx ? "true" : undefined}
                className={cn("relative h-8 rounded-md border text-xs font-medium tabular-nums", isAns ? "border-accent bg-accent text-accent-foreground" : "border-border-strong bg-surface hover:bg-surface-2", i === idx && "ring-2 ring-accent ring-offset-1 ring-offset-background")}>
                {i + 1}
                {a?.marked && <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-warning" />}
              </button>
            );
          })}
        </nav>
        <div className="space-y-1 text-[11px] text-muted"><div><span className="mr-1 inline-block size-2.5 rounded-sm bg-accent" />Answered</div><div><span className="mr-1 inline-block size-2.5 rounded-sm border border-border-strong" />Unanswered</div><div><span className="mr-1 inline-block size-2.5 rounded-full bg-warning" />Marked for review</div></div>
        <Button variant="primary" className="w-full" onClick={() => setConfirming(true)} disabled={submitting}>Submit quiz</Button>
      </aside>

      <section className="min-w-0 rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="text-sm font-semibold">Question {idx + 1} of {qs.length}</div>
          <div className="flex items-center gap-2">
            {q.multi && <Badge tone="accent">Select all that apply</Badge>}
            <Badge>{q.marks} mark{q.marks === 1 ? "" : "s"}</Badge>
            {session.settings.negative_marking.enabled && <Badge tone="warning">−{Math.round(session.settings.negative_marking.penalty_fraction * 100)}% if wrong</Badge>}
          </div>
        </div>
        <div className="space-y-4 p-5">
          <Markdown>{q.statement_md}</Markdown>
          {q.code_snippet && <pre className="code-block">{q.code_snippet}</pre>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {q.imageUrl && <img src={q.imageUrl} alt="Question illustration" className="max-h-72 rounded-md border border-border" />}
          <fieldset className="space-y-2" disabled={submitting}>
            <legend className="sr-only">Answer options</legend>
            {q.options.map((o, i) => {
              const checked = cur.selected.includes(o.id);
              return (
                <label key={o.id} className={cn("flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm", checked ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
                  <input className="mt-0.5" type={q.multi ? "checkbox" : "radio"} name={`q-${q.versionId}`} checked={checked}
                    onChange={(e) => update(q.versionId, { selected: q.multi ? (e.target.checked ? [...cur.selected, o.id] : cur.selected.filter((x) => x !== o.id)) : [o.id] })} />
                  <span className="w-5 shrink-0 font-mono text-xs text-muted">{String.fromCharCode(65 + i)}</span>
                  <span className="whitespace-pre-wrap">{o.text}</span>
                </label>
              );
            })}
          </fieldset>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <Button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>← Previous</Button>
          <Button onClick={() => setIdx((i) => Math.min(qs.length - 1, i + 1))} disabled={idx === qs.length - 1}>Next →</Button>
          <Button variant="ghost" onClick={() => update(q.versionId, { selected: [] })} disabled={cur.selected.length === 0}>Clear answer</Button>
          <Button variant={cur.marked ? "secondary" : "ghost"} onClick={() => update(q.versionId, { marked: !cur.marked })} aria-pressed={cur.marked}>{cur.marked ? "★ Marked for review" : "☆ Mark for review"}</Button>
        </div>
      </section>

      {confirming && (
        <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border-strong bg-surface p-5 shadow-xl">
            <h2 id="confirm-title" className="text-base font-semibold">Submit this quiz?</h2>
            <p className="mt-2 text-sm text-muted">{answered} of {qs.length} answered{qs.length - answered > 0 && <>, <strong className="text-warning">{qs.length - answered} unanswered</strong></>}{marked > 0 && <>, {marked} marked for review</>}. You can&apos;t change answers after submitting.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)} disabled={submitting}>Keep working</Button>
              <Button variant="primary" onClick={() => void doSubmit()} disabled={submitting}>{submitting ? "Submitting…" : "Submit"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
