"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge, DifficultyBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { archiveQuiz, deleteQuizDraft, publishQuiz, releaseQuiz, saveQuizDraft, unpublishQuiz } from "@/lib/actions/quizzes";
import type { QuizSettings } from "@/lib/mcq/settings";
import type { BankQuestion } from "./builder-data";

interface Selected { questionId: string; title: string; version?: number; marks: number }
export interface QuizInitial {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  settings: QuizSettings;
  selected: Selected[];
  attempts: number;
  resultsReleased: boolean;
  answersReleased: boolean;
}

const DEFAULT_SETTINGS: QuizSettings = {
  timer_minutes: null, max_attempts: 1, negative_marking: { enabled: false, penalty_fraction: 0.25 },
  partial_multi: false, shuffle_questions: false, shuffle_options: false, show_score: "immediately", show_answers: "after_release",
};

export function QuizBuilder({ bank, initial }: { bank: BankQuestion[]; initial: QuizInitial | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [settings, setSettings] = useState<QuizSettings>(initial?.settings ?? DEFAULT_SETTINGS);
  const [selected, setSelected] = useState<Selected[]>(initial?.selected ?? []);
  const [filter, setFilter] = useState("");
  const locked = !!initial && initial.status !== "draft";
  const total = selected.reduce((s, q) => s + (Number(q.marks) || 0), 0);
  const ids = useMemo(() => new Set(selected.map((s) => s.questionId)), [selected]);
  const visible = useMemo(() => bank.filter((b) => !ids.has(b.questionId) && (!filter || `${b.title} ${b.topic ?? ""}`.toLowerCase().includes(filter.toLowerCase()))), [bank, ids, filter]);

  const set = <K extends keyof QuizSettings>(k: K, v: QuizSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  function save(then?: (id: string) => Promise<void>) {
    start(async () => {
      const r = await saveQuizDraft({ assessmentId: initial?.id ?? null, title, description, settings, questions: selected.map((s) => ({ question_id: s.questionId, marks: Number(s.marks) || 0 })) });
      if (!r.ok) return void toast.error(r.error);
      if (then) await then(r.assessmentId);
      else {
        toast.success("Saved");
        if (!initial) router.replace(`/admin/quizzes/${r.assessmentId}`);
        else router.refresh();
      }
    });
  }
  const publish = () => save(async (id) => {
    const r = await publishQuiz(id);
    if (!r.ok) { toast.error(r.error); if (!initial) router.replace(`/admin/quizzes/${id}`); return; }
    toast.success("Published — every student is notified");
    router.replace(`/admin/quizzes/${id}`);
    router.refresh();
  });
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => { const r = await fn(); if (!r.ok) return void toast.error(r.error); toast.success(msg); router.refresh(); });

  const bad = bank.filter((b) => ids.has(b.questionId) && (b.correctCount === 0 || b.optionCount < 2));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{initial ? initial.title : "New quiz"}</h1>
          {initial && <Badge tone={initial.status === "published" ? "success" : "neutral"}>{initial.status}</Badge>}
          {initial && initial.attempts > 0 && <Badge>{initial.attempts} submitted</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!locked && <Button onClick={() => save()} disabled={pending}>Save draft</Button>}
          {!locked && <Button variant="primary" onClick={publish} disabled={pending || selected.length === 0 || !title.trim()}>Publish</Button>}
          {initial?.status === "published" && <Button onClick={() => act(() => unpublishQuiz(initial.id), "Unpublished")} disabled={pending || initial.attempts > 0} title={initial.attempts > 0 ? "Attempts exist — archive instead" : undefined}>Unpublish</Button>}
          {initial && initial.status !== "archived" && initial.status !== "draft" && <Button onClick={() => confirm("Archive this quiz?") && act(() => archiveQuiz(initial.id), "Archived")} disabled={pending}>Archive</Button>}
          {initial?.status === "draft" && <Button variant="danger" onClick={() => confirm("Delete this draft quiz?") && start(async () => { const r = await deleteQuizDraft(initial.id); if (!r.ok) return void toast.error(r.error); router.replace("/admin/quizzes"); })} disabled={pending}>Delete draft</Button>}
        </div>
      </div>
      {locked && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">This quiz is {initial!.status}: questions and settings are frozen so attempts can&apos;t change underneath the student. Use the release controls below.</p>}
      {bad.length > 0 && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">These questions have no valid answer key and will block publishing: {bad.map((b) => b.title).join("; ")}</p>}

      {initial && initial.status !== "draft" && (
        <Panel>
          <PanelHeader title="Release to student" />
          <div className="flex flex-wrap items-center gap-6 p-4 text-sm">
            <div className="flex items-center gap-3"><span>Scores: <strong>{settings.show_score === "immediately" ? "shown immediately" : initial.resultsReleased ? "released" : "held back"}</strong></span>
              {settings.show_score === "after_release" && !initial.resultsReleased && <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => releaseQuiz(initial.id, "results"), "Results released")}>Release results</Button>}</div>
            <div className="flex items-center gap-3"><span>Answers &amp; explanations: <strong>{settings.show_answers === "never" ? "never shown" : settings.show_answers === "immediately" ? "shown immediately" : initial.answersReleased ? "released" : "held back"}</strong></span>
              {settings.show_answers === "after_release" && !initial.answersReleased && <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => releaseQuiz(initial.id, "answers"), "Answers released")}>Release answers</Button>}</div>
          </div>
        </Panel>
      )}

      <Panel className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} /></Field>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={`Selected questions (${selected.length}) · ${total} marks`} />
          <ol className="divide-y divide-border text-sm">
            {selected.length === 0 && <li className="p-4 text-muted">Add MCQs from the bank →</li>}
            {selected.map((s, i) => (
              <li key={s.questionId} className="flex items-center gap-2 px-3 py-2">
                <span className="w-6 text-right font-mono text-xs text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{s.title}{s.version && <span className="ml-1 text-xs text-muted">v{s.version}</span>}</span>
                <Input type="number" min={0} step="any" className="w-16" value={s.marks} disabled={locked} aria-label={`Marks for ${s.title}`} onChange={(e) => setSelected((c) => c.map((x) => (x.questionId === s.questionId ? { ...x, marks: Number(e.target.value) } : x)))} />
                {!locked && (<>
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => setSelected((c) => { const a = [...c]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })}>↑</Button>
                  <Button size="sm" variant="ghost" disabled={i === selected.length - 1} onClick={() => setSelected((c) => { const a = [...c]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })}>↓</Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => setSelected((c) => c.filter((x) => x.questionId !== s.questionId))}>✕</Button>
                </>)}
              </li>
            ))}
          </ol>
        </Panel>
        {!locked && (
          <Panel>
            <PanelHeader title="MCQ bank" actions={<Button size="sm" disabled={visible.length === 0} onClick={() => setSelected((c) => [...c, ...visible.filter((b) => b.correctCount > 0).map((b) => ({ questionId: b.questionId, title: b.title, marks: b.marks }))])}>Add all valid ({visible.filter((b) => b.correctCount > 0).length})</Button>} />
            <div className="border-b border-border p-2"><Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter MCQ bank" /></div>
            <ul className="max-h-96 divide-y divide-border overflow-y-auto text-sm">
              {visible.length === 0 && <li className="p-4 text-muted">No MCQs available. Create or import some first.</li>}
              {visible.map((b) => (
                <li key={b.questionId} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1"><span className="truncate">{b.title}</span><span className="ml-2 inline-flex gap-1 align-middle"><DifficultyBadge level={b.difficulty} />{b.correctCount === 0 && <Badge tone="danger">no answer key</Badge>}{b.multi && <Badge>multi</Badge>}</span></span>
                  <Button size="sm" onClick={() => setSelected((c) => [...c, { questionId: b.questionId, title: b.title, marks: b.marks }])}>Add</Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <Panel>
        <PanelHeader title="Settings" />
        <fieldset disabled={locked} className="grid gap-4 p-4 md:grid-cols-3">
          <Field label="Time limit (minutes, blank = none)"><Input type="number" min={1} value={settings.timer_minutes ?? ""} onChange={(e) => set("timer_minutes", e.target.value ? Number(e.target.value) : null)} /></Field>
          <Field label="Attempts allowed"><Input type="number" min={1} max={20} value={settings.max_attempts} onChange={(e) => set("max_attempts", Math.max(1, Number(e.target.value) || 1))} /></Field>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.shuffle_questions} onChange={(e) => set("shuffle_questions", e.target.checked)} /> Shuffle question order</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.shuffle_options} onChange={(e) => set("shuffle_options", e.target.checked)} /> Shuffle options</label>
          </div>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.negative_marking.enabled} onChange={(e) => set("negative_marking", { ...settings.negative_marking, enabled: e.target.checked })} /> Negative marking</label>
            {settings.negative_marking.enabled && <Field label="Penalty (% of the question's marks)"><Input type="number" min={0} max={100} value={Math.round(settings.negative_marking.penalty_fraction * 100)} onChange={(e) => set("negative_marking", { ...settings.negative_marking, penalty_fraction: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} /></Field>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.partial_multi} onChange={(e) => set("partial_multi", e.target.checked)} /> Partial credit on multi-answer questions</label>
          </div>
          <Field label="Student sees score"><Select value={settings.show_score} onChange={(e) => set("show_score", e.target.value as QuizSettings["show_score"])}><option value="immediately">Immediately after submitting</option><option value="after_release">After I release results</option></Select></Field>
          <Field label="Student sees correct answers"><Select value={settings.show_answers} onChange={(e) => set("show_answers", e.target.value as QuizSettings["show_answers"])}><option value="after_release">After I release answers</option><option value="immediately">Immediately after submitting</option><option value="never">Never</option></Select></Field>
        </fieldset>
      </Panel>
    </div>
  );
}
