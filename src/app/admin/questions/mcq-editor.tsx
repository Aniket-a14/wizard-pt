"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Markdown } from "@/components/ui/markdown";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { saveMcqDraft, unpublishQuestion, uploadQuestionImage } from "@/lib/actions/questions";
import type { ImportFlag } from "@/lib/import/text-parser";

export interface McqForm {
  questionId: string | null;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
  tagsText: string;
  company: string;
  marks: number;
  statement_md: string;
  codeSnippet: string;
  imagePath: string | null;
  imageUrl: string | null;
  multi: boolean;
  options: { text: string; correct: boolean }[];
  explanation: string;
  reviewFlags: ImportFlag[];
  importId: string | null;
}

export const EMPTY_MCQ: McqForm = {
  questionId: null, title: "", difficulty: "easy", topic: "", tagsText: "", company: "", marks: 1, statement_md: "", codeSnippet: "",
  imagePath: null, imageUrl: null, multi: false, options: [{ text: "", correct: false }, { text: "", correct: false }, { text: "", correct: false }, { text: "", correct: false }],
  explanation: "", reviewFlags: [], importId: null,
};

export function McqEditor({ initial, status, version, versionPublished }: { initial: McqForm; status: "draft" | "published" | "archived"; version: number; versionPublished: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [dirty, setDirty] = useState(!initial.questionId);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function set<K extends keyof McqForm>(k: K, v: McqForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  }
  const updOpt = (i: number, patch: Partial<McqForm["options"][number]>) => set("options", form.options.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const correctCount = form.options.filter((o) => o.correct).length;

  function setCorrect(i: number, checked: boolean) {
    if (form.multi) updOpt(i, { correct: checked });
    else set("options", form.options.map((o, k) => ({ ...o, correct: k === i ? checked : false })));
  }

  function onSave() {
    start(async () => {
      const r = await saveMcqDraft({
        questionId: form.questionId,
        title: form.title || form.statement_md.split("\n")[0].slice(0, 90),
        difficulty: form.difficulty,
        topic: form.topic,
        tags: form.tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        company: form.company,
        marks: Number(form.marks) || 0,
        statement_md: form.statement_md,
        code_snippet: form.codeSnippet,
        image_path: form.imagePath,
        mcq_multi: form.multi,
        explanation_md: form.explanation,
        review_flags: form.reviewFlags,
        import_id: form.importId,
        options: form.options.map((o) => ({ text: o.text, correct: o.correct })),
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      setDirty(false);
      toast.success("Saved");
      if (!form.questionId) router.replace(`/admin/questions/${r.questionId}`);
      else router.refresh();
      setForm((f) => ({ ...f, questionId: r.questionId }));
    });
  }

  function onUpload(file: File | undefined) {
    if (!file) return;
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const r = await uploadQuestionImage(fd);
      if (!r.ok) return void toast.error(r.error);
      setForm((f) => ({ ...f, imagePath: r.path, imageUrl: URL.createObjectURL(file) }));
      setDirty(true);
      toast.success("Image uploaded — save to attach it");
    });
  }

  function onArchive() {
    if (!form.questionId || !confirm("Archive this question?")) return;
    start(async () => {
      const r = await unpublishQuestion(form.questionId!, true);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Archived");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{form.questionId ? form.title || "MCQ" : "New MCQ"}</h1>
          {form.questionId && <Badge tone={status === "published" ? "success" : "neutral"}>{status}</Badge>}
          {form.questionId && <Badge>v{version}{versionPublished ? " published" : " draft"}</Badge>}
          {dirty && <Badge tone="warning">unsaved</Badge>}
        </div>
        <div className="flex gap-2">
          {form.questionId && status !== "archived" && <Button onClick={onArchive} disabled={pending}>Archive</Button>}
          <Button variant="primary" onClick={onSave} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </div>
      </div>
      <p className="text-sm text-muted">MCQs reach the student through a quiz — add this question to one in <strong>Quizzes</strong>. Publishing the quiz freezes this version.</p>
      {versionPublished && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">v{version} is frozen because a published quiz uses it. Saving creates v{version + 1}; existing quizzes and attempts keep v{version}.</p>}
      {form.reviewFlags.length > 0 && (
        <Panel className="border-warning/40 bg-warning-soft px-4 py-3">
          <div className="flex items-center justify-between"><div className="text-sm font-medium text-warning">Imported content needs your review</div><button className="text-xs text-warning underline" onClick={() => set("reviewFlags", [])}>Dismiss all</button></div>
          <ul className="mt-1 list-disc pl-5 text-sm">{form.reviewFlags.map((f, i) => <li key={i}><span className="font-mono text-xs">{f.field}</span> — {f.message}</li>)}</ul>
        </Panel>
      )}

      <Panel className="grid gap-4 p-4 md:grid-cols-6">
        <Field label="Short title (optional — defaults to the first line)" className="md:col-span-3"><Input value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="Difficulty" className="md:col-span-1"><Select value={form.difficulty} onChange={(e) => set("difficulty", e.target.value as McqForm["difficulty"])}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select></Field>
        <Field label="Marks" className="md:col-span-1"><Input type="number" min={0} step="any" value={form.marks} onChange={(e) => set("marks", Number(e.target.value))} /></Field>
        <Field label="Company" className="md:col-span-1"><Input value={form.company} onChange={(e) => set("company", e.target.value)} /></Field>
        <Field label="Topic" className="md:col-span-3"><Input value={form.topic} onChange={(e) => set("topic", e.target.value)} /></Field>
        <Field label="Tags (comma separated)" className="md:col-span-3"><Input value={form.tagsText} onChange={(e) => set("tagsText", e.target.value)} /></Field>
      </Panel>

      <Panel>
        <PanelHeader title="Question (Markdown)" actions={<button className="text-xs text-accent underline" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</button>} />
        <div className="space-y-3 p-4">
          {preview ? <Markdown>{form.statement_md || "_Nothing yet_"}</Markdown> : <Textarea rows={5} value={form.statement_md} onChange={(e) => set("statement_md", e.target.value)} className="font-mono text-xs" />}
          {errors.statement_md && <p className="text-xs text-danger">{errors.statement_md}</p>}
          <Field label="Code snippet (optional, shown below the question)"><Textarea rows={4} className="font-mono text-xs" value={form.codeSnippet} onChange={(e) => set("codeSnippet", e.target.value)} /></Field>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-muted">Image (optional)
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="mt-1 block text-sm" onChange={(e) => onUpload(e.target.files?.[0])} />
            </label>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {form.imageUrl && <img src={form.imageUrl} alt="Question illustration" className="h-16 rounded border border-border" />}
            {form.imagePath && <button className="text-xs text-danger underline" onClick={() => { setForm((f) => ({ ...f, imagePath: null, imageUrl: null })); setDirty(true); }}>Remove</button>}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Options & answer key" actions={
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.multi} onChange={(e) => { setForm((f) => ({ ...f, multi: e.target.checked, options: e.target.checked ? f.options : f.options.map((o, k) => ({ ...o, correct: o.correct && f.options.findIndex((x) => x.correct) === k })) })); setDirty(true); }} /> Multiple correct answers</label>
        } />
        <div className="space-y-2 p-4">
          {form.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-center font-mono text-xs text-muted">{String.fromCharCode(65 + i)}</span>
              <input aria-label={`Option ${String.fromCharCode(65 + i)} is correct`} type={form.multi ? "checkbox" : "radio"} name="correct" checked={o.correct} onChange={(e) => setCorrect(i, e.target.checked)} />
              <Input value={o.text} onChange={(e) => updOpt(i, { text: e.target.value })} placeholder={`Option ${String.fromCharCode(65 + i)}`} />
              <Button size="sm" variant="ghost" className="text-danger" disabled={form.options.length <= 2} onClick={() => { set("options", form.options.filter((_, k) => k !== i)); }}>✕</Button>
            </div>
          ))}
          {errors["options.0.text"] && <p className="text-xs text-danger">{errors["options.0.text"]}</p>}
          <div className="flex items-center gap-3 pt-1">
            <Button size="sm" disabled={form.options.length >= 10} onClick={() => set("options", [...form.options, { text: "", correct: false }])}>Add option</Button>
            <span className={correctCount === 0 ? "text-xs text-danger" : "text-xs text-muted"}>{correctCount === 0 ? "Mark the correct option(s) — required before the quiz can be published" : `${correctCount} correct`}</span>
          </div>
        </div>
      </Panel>
      <Field label="Explanation (private until answers are released)"><Textarea rows={3} value={form.explanation} onChange={(e) => set("explanation", e.target.value)} /></Field>
    </div>
  );
}
