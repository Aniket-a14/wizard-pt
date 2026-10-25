"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { commitImport, parsePastedText, uploadPdfs, type ImportPreview } from "@/lib/actions/imports";
import type { ParsedCoding, ParsedMcq, ParsedQuestion } from "@/lib/import/text-parser";
import { requestIdentity, type RequestIdentity } from "@/lib/idempotency";
import { cn } from "@/lib/utils";

interface Item {
  key: string;
  importId: string | null;
  source: string;
  selected: boolean;
  q: ParsedQuestion;
}

export function ImportWizard({ initialMode = "text" }: { initialMode?: "text" | "pdf" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"text" | "pdf">(initialMode);
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState<{ source: string; status: string; message: string }[]>([]);
  const [pending, start] = useTransition();

  function absorb(previews: ImportPreview[]) {
    setNotes(previews.map((p) => ({ source: p.source, status: p.status, message: p.message })));
    setItems(previews.flatMap((p, pi) => p.questions.map((q, qi) => ({ key: `${pi}-${qi}-${Date.now()}`, importId: p.importId || null, source: p.source, selected: true, q }))));
  }

  function onParse() {
    start(async () => {
      const r = await parsePastedText(text);
      if (!r.ok) return void toast.error(r.error);
      absorb([r.preview]);
    });
  }
  function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    start(async () => {
      const fd = new FormData();
      [...files].forEach((f) => fd.append("files", f));
      const r = await uploadPdfs(fd);
      if (!r.ok) return void toast.error(r.error);
      absorb(r.previews);
    });
  }
  function patch(key: string, fn: (q: ParsedQuestion) => ParsedQuestion) {
    setItems((cur) => cur.map((i) => (i.key === key ? { ...i, q: fn(i.q) } : i)));
  }
  function changeKind(key: string, kind: "coding" | "mcq") {
    patch(key, (q) => {
      if (q.kind === kind) return q;
      const base = { title: q.title, difficulty: q.difficulty, topic: q.topic, tags: q.tags, company: q.company, statement_md: q.statement_md, flags: q.flags, raw: q.raw };
      return kind === "mcq"
        ? ({ kind: "mcq", ...base, options: ["", ""], correct: [], multi: false, explanation: "" } as ParsedMcq)
        : ({ kind: "coding", ...base, input_format: "", output_format: "", constraints_md: "", function_signature: "", examples: [] } as ParsedCoding);
    });
  }

  const commitKey = useRef<RequestIdentity | null>(null);
  const selected = items.filter((i) => i.selected);
  function onCommit() {
    start(async () => {
      const payload = selected.map((i) => ({ importId: i.importId, question: i.q }));
      commitKey.current = requestIdentity(commitKey.current, JSON.stringify(payload));
      const r = await commitImport(payload, commitKey.current.key);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.created.length} draft question${r.created.length === 1 ? "" : "s"} created`);
      if (r.created.length === 1) router.push(`/admin/questions/${r.created[0].questionId}`);
      else router.push("/admin/questions?status=draft");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {(["text", "pdf"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={cn("rounded-md border px-3 py-1.5 text-sm", mode === m ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted hover:bg-surface-2")}>
            {m === "text" ? "Paste text" : "Upload PDF(s)"}
          </button>
        ))}
      </div>

      {mode === "text" ? (
        <Panel className="space-y-3 p-4">
          <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" aria-label="Pasted questions" placeholder={"Paste one or many questions — coding problems (\"Problem 2 — Title [Easy | Topic]\") or MCQs (\"1. Question … A. … B. … Answer: B\")."} />
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={onParse} disabled={pending || !text.trim()}>{pending ? "Parsing…" : "Parse"}</Button>
            <span className="text-xs text-muted">Parsing is deterministic and never invents answers, hidden tests or reference solutions.</span>
          </div>
        </Panel>
      ) : (
        <Panel className="space-y-3 p-4">
          <input type="file" accept="application/pdf,.pdf" multiple aria-label="PDF files" disabled={pending} onChange={(e) => onUpload(e.target.files)} className="text-sm" />
          <p className="text-xs text-muted">Text-based PDFs up to 15 MB each. Scanned/image-only PDFs are reported as needing OCR — they are not silently accepted. The original file is stored privately and linked to the imported questions.</p>
          {pending && <p className="text-sm text-muted">Extracting…</p>}
        </Panel>
      )}

      {notes.map((n, i) => (
        <p key={i} className={cn("rounded-md px-3 py-2 text-sm", n.status === "parsed" ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
          <strong>{n.source}:</strong> {n.message}
        </p>
      ))}

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">Review ({selected.length} of {items.length} selected)</h2>
            <button className="text-xs text-accent underline" onClick={() => setItems((c) => c.map((i) => ({ ...i, selected: true })))}>Select all</button>
            <button className="text-xs text-accent underline" onClick={() => setItems((c) => c.map((i) => ({ ...i, selected: false })))}>None</button>
            <Button className="ml-auto" variant="primary" onClick={onCommit} disabled={pending || selected.length === 0}>Create {selected.length} draft{selected.length === 1 ? "" : "s"}</Button>
          </div>
          {items.map((it) => (
            <ItemCard key={it.key} item={it} onToggle={() => setItems((c) => c.map((x) => (x.key === it.key ? { ...x, selected: !x.selected } : x)))} onPatch={(fn) => patch(it.key, fn)} onKind={(k) => changeKind(it.key, k)} />
          ))}
        </>
      )}
    </div>
  );
}

function ItemCard({ item, onToggle, onPatch, onKind }: { item: Item; onToggle: () => void; onPatch: (fn: (q: ParsedQuestion) => ParsedQuestion) => void; onKind: (k: "coding" | "mcq") => void }) {
  const q = item.q;
  const set = <K extends string>(k: K, v: unknown) => onPatch((cur) => ({ ...cur, [k]: v }) as ParsedQuestion);
  return (
    <Panel className={cn(!item.selected && "opacity-60")}>
      <PanelHeader
        title={
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={item.selected} onChange={onToggle} aria-label={`Import ${q.title || "question"}`} />
            <span>{q.title || "(untitled)"}</span>
            <Badge tone={q.kind === "coding" ? "accent" : "neutral"}>{q.kind === "coding" ? "Coding" : "MCQ"}</Badge>
            <span className="text-xs font-normal text-muted">{item.source}</span>
          </label>
        }
        actions={<Select className="w-36" value={q.kind} onChange={(e) => onKind(e.target.value as "coding" | "mcq")} aria-label="Question type"><option value="coding">Coding problem</option><option value="mcq">MCQ</option></Select>}
      />
      {q.flags.filter((f) => f.field !== "tests").length > 0 && (
        <ul className="list-disc space-y-0.5 border-b border-border bg-warning-soft px-8 py-2 text-xs text-warning">
          {q.flags.filter((f) => f.field !== "tests").map((f, i) => (<li key={i}>{f.message}</li>))}
        </ul>
      )}
      <div className="grid gap-3 p-4 md:grid-cols-6">
        <Field label="Title" className="md:col-span-3"><Input value={q.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="Difficulty" className="md:col-span-1"><Select value={q.difficulty ?? "easy"} onChange={(e) => set("difficulty", e.target.value)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select></Field>
        <Field label="Topic" className="md:col-span-2"><Input value={q.topic} onChange={(e) => { set("topic", e.target.value); set("tags", e.target.value.split(/\s*(?:\+|,|\/)\s*/).filter(Boolean)); }} /></Field>
        <Field label={q.kind === "coding" ? "Description" : "Question"} className="md:col-span-6"><Textarea rows={q.kind === "coding" ? 5 : 3} value={q.statement_md} onChange={(e) => set("statement_md", e.target.value)} /></Field>
        {q.kind === "coding" ? (
          <>
            <Field label="Function signature" className="md:col-span-3"><Input className="font-mono" value={q.function_signature} onChange={(e) => set("function_signature", e.target.value)} placeholder="public static String name(String arg)" /></Field>
            <Field label="Constraints" className="md:col-span-3"><Input value={q.constraints_md} onChange={(e) => set("constraints_md", e.target.value)} /></Field>
            <Field label="Input format" className="md:col-span-3"><Textarea rows={2} value={q.input_format} onChange={(e) => set("input_format", e.target.value)} /></Field>
            <Field label="Output format" className="md:col-span-3"><Textarea rows={2} value={q.output_format} onChange={(e) => set("output_format", e.target.value)} /></Field>
            <div className="md:col-span-6">
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted">Examples → public tests ({q.examples.length})
                <button className="text-accent underline" onClick={() => set("examples", [...q.examples, { input: "", output: "", explanation: "" }])}>Add</button></div>
              {q.examples.map((e, i) => (
                <div key={i} className="mb-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <Textarea rows={2} className="font-mono text-xs" value={e.input} aria-label={`Example ${i + 1} input`} onChange={(ev) => set("examples", q.examples.map((x, k) => (k === i ? { ...x, input: ev.target.value } : x)))} />
                  <Textarea rows={2} className="font-mono text-xs" value={e.output} aria-label={`Example ${i + 1} output`} onChange={(ev) => set("examples", q.examples.map((x, k) => (k === i ? { ...x, output: ev.target.value } : x)))} />
                  <button className="text-xs text-danger underline" onClick={() => set("examples", q.examples.filter((_, k) => k !== i))}>Remove</button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-2 md:col-span-6">
            <div className="text-xs font-medium text-muted">Options (tick the correct answer{q.multi ? "s" : ""})</div>
            {(q as ParsedMcq).options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 text-center font-mono text-xs text-muted">{String.fromCharCode(65 + i)}</span>
                <input type="checkbox" aria-label={`Option ${String.fromCharCode(65 + i)} correct`} checked={(q as ParsedMcq).correct.includes(i)} onChange={(e) => { const c = new Set((q as ParsedMcq).correct); if (e.target.checked) c.add(i); else c.delete(i); onPatch((cur) => ({ ...cur, correct: [...c].sort(), multi: c.size > 1 }) as ParsedQuestion); }} />
                <Input value={o} onChange={(e) => set("options", (q as ParsedMcq).options.map((x, k) => (k === i ? e.target.value : x)))} />
                <button className="text-xs text-danger" onClick={() => onPatch((cur) => { const m = cur as ParsedMcq; return { ...m, options: m.options.filter((_, k) => k !== i), correct: m.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)) } as ParsedQuestion; })}>✕</button>
              </div>
            ))}
            <button className="text-xs text-accent underline" onClick={() => set("options", [...(q as ParsedMcq).options, ""])}>Add option</button>
            <Field label="Explanation"><Textarea rows={2} value={(q as ParsedMcq).explanation} onChange={(e) => set("explanation", e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Panel>
  );
}
