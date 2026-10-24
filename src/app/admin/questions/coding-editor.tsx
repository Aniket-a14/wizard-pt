"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CodeEditor, CodeViewer } from "@/components/code-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Markdown } from "@/components/ui/markdown";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { parsePastedText } from "@/lib/actions/imports";
import { publishCodingQuestion, saveCodingDraft, unpublishQuestion, validateWithReference, type ValidationReport } from "@/lib/actions/questions";
import { composeProgram } from "@/lib/coding/compose";
import { buildFunctionTemplate, parseBoilerplate, EDIT_START, EDIT_END } from "@/lib/coding/harness";
import { checkTestInputShape, parseSignature } from "@/lib/coding/signature";
import { cn } from "@/lib/utils";
import type { ImportFlag, ParsedCoding } from "@/lib/import/text-parser";

export interface CodingForm {
  questionId: string | null;
  versionId: string | null;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
  tagsText: string;
  company: string;
  marks: number;
  estMinutes: string;
  statement_md: string;
  input_format: string;
  output_format: string;
  constraints_md: string;
  examples: { input: string; output: string; explanation: string }[];
  explanation_md: string;
  executionMode: "function" | "program";
  gradingMode: "auto" | "manual";
  functionSignature: string;
  editableScope: "method" | "body";
  starterCode: string;
  boilerplateSource: string;
  referenceSolution: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  compareMode: "exact" | "trim" | "tokens" | "float";
  floatTolerance: number;
  allowCustomInput: boolean;
  revealHidden: boolean;
  tests: { input: string; expected_output: string; visibility: "public" | "hidden"; weight: number; label: string }[];
  reviewFlags: ImportFlag[];
  importId: string | null;
}

export interface CodingMeta {
  status: "draft" | "published" | "archived";
  version: number;
  versionPublished: boolean;
  publishedVersion: number | null;
  lastValidation: ValidationReport | null;
}

export const EMPTY_CODING: CodingForm = {
  questionId: null, versionId: null, title: "", difficulty: "easy", topic: "", tagsText: "", company: "", marks: 10, estMinutes: "",
  statement_md: "", input_format: "", output_format: "", constraints_md: "", examples: [], explanation_md: "",
  executionMode: "function", gradingMode: "auto", functionSignature: "", editableScope: "method", starterCode: "", boilerplateSource: "",
  referenceSolution: "", timeLimitMs: 2000, memoryLimitMb: 256, compareMode: "exact", floatTolerance: 1e-6, allowCustomInput: true, revealHidden: false,
  tests: [], reviewFlags: [], importId: null,
};

const TABS = [
  ["problem", "1 · Problem"],
  ["code", "2 · Code setup"],
  ["tests", "3 · Test cases"],
  ["publish", "4 · Review & publish"],
] as const;
type Tab = (typeof TABS)[number][0];

export function CodingEditor({ initial, meta }: { initial: CodingForm; meta: CodingMeta }) {
  const router = useRouter();
  const [form, setForm] = useState<CodingForm>(initial);
  const [tab, setTab] = useState<Tab>("problem");
  const [dirty, setDirty] = useState(!initial.questionId);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [report, setReport] = useState<ValidationReport | null>(meta.lastValidation);
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function set<K extends keyof CodingForm>(key: K, value: CodingForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setReport(null);
  }

  const sigState = useMemo(() => {
    if (form.executionMode !== "function") return null;
    if (!form.functionSignature.trim()) return { ok: false as const, message: "Enter the method signature" };
    try {
      const s = parseSignature(form.functionSignature);
      return { ok: true as const, sig: s, message: `${s.name}(${s.params.map((p) => p.type).join(", ")}) → ${s.returnType}` };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  }, [form.executionMode, form.functionSignature]);

  const composed = useMemo(() => {
    try {
      if (form.executionMode === "program") {
        return { ok: true as const, source: form.starterCode || "(starter code is empty)" };
      }
      if (!sigState?.ok) return { ok: false as const, message: "Fix the signature to preview the program." };
      let prefix: string, suffix: string, starter = form.starterCode;
      if (form.boilerplateSource.trim()) {
        const bp = parseBoilerplate(form.boilerplateSource);
        prefix = bp.prefix; suffix = bp.suffix; if (!starter.trim()) starter = bp.starter;
      } else {
        const t = buildFunctionTemplate(sigState.sig);
        prefix = t.prefix; suffix = t.suffix; if (!starter.trim()) starter = form.editableScope === "body" ? t.starterBody : t.starterMethod;
      }
      const c = composeProgram({ executionMode: "function", editableScope: form.editableScope, functionSignature: sigState.sig.declaration, templatePrefix: prefix, templateSuffix: suffix }, starter);
      return { ok: true as const, source: c.source };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  }, [form.executionMode, form.editableScope, form.boilerplateSource, form.starterCode, sigState]);

  function toInput() {
    return {
      questionId: form.questionId,
      title: form.title,
      difficulty: form.difficulty,
      topic: form.topic,
      tags: form.tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      company: form.company,
      marks: Number(form.marks) || 0,
      est_minutes: form.estMinutes.trim() ? Number(form.estMinutes) : null,
      statement_md: form.statement_md,
      input_format: form.input_format,
      output_format: form.output_format,
      constraints_md: form.constraints_md,
      examples: form.examples,
      explanation_md: form.explanation_md,
      review_flags: form.reviewFlags,
      import_id: form.importId,
      config: {
        execution_mode: form.executionMode,
        grading_mode: form.gradingMode,
        function_signature: form.functionSignature,
        editable_scope: form.editableScope,
        starter_code: form.starterCode,
        time_limit_ms: Number(form.timeLimitMs),
        memory_limit_mb: Number(form.memoryLimitMb),
        compare_mode: form.compareMode,
        float_tolerance: Number(form.floatTolerance),
        allow_custom_input: form.allowCustomInput,
        reveal_hidden: form.revealHidden,
      },
      boilerplate_source: form.boilerplateSource,
      reference_solution: form.referenceSolution,
      tests: form.tests.map((t) => ({ ...t, weight: Number(t.weight) || 1, label: t.label || null })),
    };
  }

  /** Save and return the (possibly new) ids, or null on failure. */
  async function save(): Promise<{ questionId: string; versionId: string } | null> {
    const r = await saveCodingDraft(toInput());
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      toast.error(r.error);
      return null;
    }
    setErrors({});
    setWarnings(r.warnings);
    setDirty(false);
    setForm((f) => ({ ...f, questionId: r.questionId, versionId: r.versionId }));
    return r;
  }

  function onSave() {
    start(async () => {
      const wasNew = !form.questionId;
      const r = await save();
      if (!r) return;
      toast.success("Draft saved");
      if (wasNew) router.replace(`/admin/questions/${r.questionId}`);
      else router.refresh();
    });
  }

  function onValidate() {
    start(async () => {
      let vid = form.versionId;
      if (dirty || !vid) {
        const r = await save();
        if (!r) return;
        vid = r.versionId;
      }
      const res = await validateWithReference(vid!);
      if (!res.ok) return void toast.error(res.error);
      setReport(res.report);
      toast[res.report.passed === res.report.total ? "success" : "error"](`Reference solution: ${res.report.passed}/${res.report.total} tests pass`);
    });
  }

  function onPublish() {
    start(async () => {
      const r = await save();
      if (!r) return;
      const p = await publishCodingQuestion(r.questionId);
      if (!p.ok) return void toast.error(p.error);
      toast.success("Published — the student is notified");
      router.replace(`/admin/questions/${r.questionId}`);
      router.refresh();
    });
  }

  function onUnpublish(archive: boolean) {
    if (!form.questionId) return;
    if (!confirm(archive ? "Archive this problem? Students keep their history but it disappears from their list." : "Unpublish this problem? It disappears from the student's list (existing submissions are kept).")) return;
    start(async () => {
      const r = await unpublishQuestion(form.questionId!, archive);
      if (!r.ok) return void toast.error(r.error);
      toast.success(archive ? "Archived" : "Unpublished");
      router.refresh();
    });
  }

  function onParse() {
    start(async () => {
      const r = await parsePastedText(pasteText);
      if (!r.ok) return void toast.error(r.error);
      const q = r.preview.questions.find((x): x is ParsedCoding => x.kind === "coding");
      if (!q) return void toast.error("No coding problem was found in that text.");
      let mode: "function" | "program" = "program";
      let sig = "";
      try { sig = parseSignature(q.function_signature).declaration; mode = "function"; } catch { /* stays program */ }
      setForm((f) => ({
        ...f,
        title: q.title, difficulty: q.difficulty ?? "easy", topic: q.topic, tagsText: q.tags.join(", "), company: q.company,
        statement_md: q.statement_md, input_format: q.input_format, output_format: q.output_format, constraints_md: q.constraints_md,
        examples: q.examples, executionMode: mode, functionSignature: sig, starterCode: "",
        tests: [...f.tests.filter((t) => t.visibility === "hidden"), ...q.examples.map((e, i) => ({ input: e.input, expected_output: e.output, visibility: "public" as const, weight: 1, label: `Example ${i + 1}` }))],
        reviewFlags: q.flags, importId: r.preview.importId,
      }));
      setDirty(true);
      setReport(null);
      toast.success(`Parsed "${q.title || "problem"}" — review each field before saving`);
      if (r.preview.questions.length > 1) toast.message("More than one question was found; only the first was loaded. Use Import for bulk.");
    });
  }

  const publicCount = form.tests.filter((t) => t.visibility === "public").length;
  const hiddenCount = form.tests.filter((t) => t.visibility === "hidden").length;
  const checks = [
    { ok: !!form.title.trim(), label: "Title" },
    { ok: !!form.statement_md.trim(), label: "Problem statement" },
    { ok: form.executionMode === "program" || !!sigState?.ok, label: form.executionMode === "function" ? "Valid Java method signature" : "Full-program mode" },
    { ok: composed.ok, label: "Trusted wrapper builds cleanly" },
    ...(form.gradingMode === "auto"
      ? [
          { ok: publicCount >= 1, label: `At least one public test (${publicCount})` },
          { ok: hiddenCount >= 1, label: `At least one hidden test (${hiddenCount})` },
        ]
      : [{ ok: true, label: "Manual grading — no tests required" }]),
    { ok: !dirty && !!form.questionId, label: "Saved" },
  ];
  const ready = checks.every((c) => c.ok);
  const validated = report && report.passed === report.total && report.total > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{form.questionId ? form.title || "Untitled problem" : "New coding problem"}</h1>
          {form.questionId && <Badge tone={meta.status === "published" ? "success" : "neutral"}>{meta.status}</Badge>}
          {form.questionId && <Badge>v{meta.version}{meta.versionPublished ? " published" : " draft"}</Badge>}
          {dirty && <Badge tone="warning">unsaved</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onSave} disabled={pending} variant="secondary">{pending ? "Working…" : "Save draft"}</Button>
          <Button onClick={onPublish} disabled={pending || !form.title.trim()} variant="primary">Publish</Button>
        </div>
      </div>

      {meta.versionPublished && (
        <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">
          Version {meta.version} is published and frozen. Saving creates version {meta.version + 1} as a draft; the student keeps seeing v{meta.publishedVersion} (and any attempt in progress) until you publish it.
        </p>
      )}
      {form.reviewFlags.length > 0 && (
        <Panel className="border-warning/40 bg-warning-soft px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-warning">Imported content needs your review</div>
            <button className="text-xs text-warning underline" onClick={() => set("reviewFlags", [])}>Dismiss all</button>
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {form.reviewFlags.map((f, i) => (<li key={i}><span className="font-mono text-xs">{f.field}</span> — {f.message}</li>))}
          </ul>
        </Panel>
      )}

      <div role="tablist" className="flex gap-1 border-b border-border">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === id ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {tab === "problem" && (
        <div className="space-y-4">
          {!form.questionId && (
            <details className="rounded-lg border border-dashed border-border-strong bg-surface" open={!form.title}>
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Paste a question to fill this form automatically</summary>
              <div className="space-y-2 border-t border-border p-4">
                <Textarea rows={9} value={pasteText} onChange={(e) => setPasteText(e.target.value)} className="font-mono text-xs" placeholder={"Problem 2 — Reverse Only the Letters [Easy | Strings + Two Pointers]\n\n…description…\n\nFunction signature:\npublic static String maskCode(String code)\n\nExample 1:\nInput: AB-12-CD\nOutput: DC-12-BA"} />
                <div className="flex items-center gap-3">
                  <Button onClick={onParse} disabled={pending || !pasteText.trim()} variant="primary">Parse</Button>
                  <span className="text-xs text-muted">Nothing is invented: unrecognised parts stay empty and are flagged for review.</span>
                </div>
              </div>
            </details>
          )}
          <Panel className="grid gap-4 p-4 md:grid-cols-6">
            <Field label="Title" error={errors.title} className="md:col-span-4"><Input value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
            <Field label="Difficulty" className="md:col-span-1">
              <Select value={form.difficulty} onChange={(e) => set("difficulty", e.target.value as CodingForm["difficulty"])}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </Select>
            </Field>
            <Field label="Marks" className="md:col-span-1"><Input type="number" min={0} value={form.marks} onChange={(e) => set("marks", Number(e.target.value))} /></Field>
            <Field label="Topic" className="md:col-span-2"><Input value={form.topic} onChange={(e) => set("topic", e.target.value)} placeholder="Strings + Two Pointers" /></Field>
            <Field label="Tags (comma separated)" className="md:col-span-2"><Input value={form.tagsText} onChange={(e) => set("tagsText", e.target.value)} placeholder="Strings, Two Pointers" /></Field>
            <Field label="Company (optional)" className="md:col-span-1"><Input value={form.company} onChange={(e) => set("company", e.target.value)} /></Field>
            <Field label="Est. minutes" className="md:col-span-1"><Input type="number" min={1} value={form.estMinutes} onChange={(e) => set("estMinutes", e.target.value)} /></Field>
          </Panel>
          <Panel>
            <PanelHeader title="Problem statement (Markdown)" actions={<button className="text-xs text-accent underline" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</button>} />
            <div className="p-4">
              {preview ? <Markdown>{form.statement_md || "_Nothing yet_"}</Markdown> : <Textarea rows={10} value={form.statement_md} onChange={(e) => set("statement_md", e.target.value)} className="font-mono text-xs" />}
            </div>
          </Panel>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Input format"><Textarea rows={4} value={form.input_format} onChange={(e) => set("input_format", e.target.value)} /></Field>
            <Field label="Output format"><Textarea rows={4} value={form.output_format} onChange={(e) => set("output_format", e.target.value)} /></Field>
            <Field label="Constraints"><Textarea rows={4} value={form.constraints_md} onChange={(e) => set("constraints_md", e.target.value)} /></Field>
          </div>
          <Panel>
            <PanelHeader title={`Examples shown in the statement (${form.examples.length})`} actions={<Button size="sm" onClick={() => set("examples", [...form.examples, { input: "", output: "", explanation: "" }])}>Add example</Button>} />
            <div className="space-y-3 p-4">
              {form.examples.length === 0 && <p className="text-sm text-muted">No examples yet.</p>}
              {form.examples.map((ex, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-3">
                  <Field label={`Example ${i + 1} input`}><Textarea rows={3} className="font-mono text-xs" value={ex.input} onChange={(e) => set("examples", form.examples.map((x, k) => (k === i ? { ...x, input: e.target.value } : x)))} /></Field>
                  <Field label="Output"><Textarea rows={3} className="font-mono text-xs" value={ex.output} onChange={(e) => set("examples", form.examples.map((x, k) => (k === i ? { ...x, output: e.target.value } : x)))} /></Field>
                  <Field label="Explanation (optional)"><Textarea rows={3} value={ex.explanation} onChange={(e) => set("examples", form.examples.map((x, k) => (k === i ? { ...x, explanation: e.target.value } : x)))} /></Field>
                  <button className="text-left text-xs text-danger underline md:col-span-3" onClick={() => set("examples", form.examples.filter((_, k) => k !== i))}>Remove example {i + 1}</button>
                </div>
              ))}
            </div>
          </Panel>
          <Field label="Solution explanation / editorial (private — never shown to the student by default)"><Textarea rows={4} value={form.explanation_md} onChange={(e) => set("explanation_md", e.target.value)} /></Field>
        </div>
      )}

      {tab === "code" && (
        <div className="space-y-4">
          <Panel className="grid gap-4 p-4 md:grid-cols-4">
            <Field label="Language"><Select value="java" disabled><option value="java">Java</option></Select></Field>
            <Field label="Execution mode" hint={form.executionMode === "function" ? "Student writes only the method; the platform supplies Main, input parsing and printing." : "Student writes the whole program (stdin → stdout)."}>
              <Select value={form.executionMode} onChange={(e) => set("executionMode", e.target.value as CodingForm["executionMode"])}>
                <option value="function">Function-only (default)</option><option value="program">Full program</option>
              </Select>
            </Field>
            <Field label="Grading"><Select value={form.gradingMode} onChange={(e) => set("gradingMode", e.target.value as CodingForm["gradingMode"])}><option value="auto">Automatic (test cases)</option><option value="manual">Manual review only</option></Select></Field>
            {form.executionMode === "function" && (
              <Field label="Editable region">
                <Select value={form.editableScope} onChange={(e) => set("editableScope", e.target.value as CodingForm["editableScope"])}>
                  <option value="method">Whole method (signature included)</option><option value="body">Method body only (signature locked)</option>
                </Select>
              </Field>
            )}
            {form.executionMode === "function" && (
              <div className="md:col-span-4">
                <Field label="Method signature" error={errors["config.function_signature"]}>
                  <Input value={form.functionSignature} onChange={(e) => set("functionSignature", e.target.value)} className="font-mono" placeholder="public static String maskCode(String code)" />
                </Field>
                <p className={cn("mt-1 text-xs", sigState?.ok ? "text-success" : "text-danger")}>{sigState?.message}</p>
                <p className="mt-1 text-xs text-muted">Supported types: String, int, long, double, boolean, char, int[], long[], double[], boolean[], String[], and ArrayList&lt;String&gt; / List&lt;String&gt; (parameters only). Test inputs: one line per parameter; arrays are space-separated on one line; String[] is a count line followed by one line per element; a list is a count line followed by one line of space-separated items.</p>
              </div>
            )}
          </Panel>

          {form.executionMode === "function" && (
            <Panel>
              <PanelHeader title="Pasted Java boilerplate (optional)" />
              <div className="space-y-2 p-4">
                <p className="text-sm text-muted">Leave empty to let the platform generate the wrapper from the signature. Or paste a complete program and mark the region the student edits with these two comment lines (exactly one of each):</p>
                <pre className="code-block">{EDIT_START}{"\n"}{EDIT_END}</pre>
                <Textarea rows={10} value={form.boilerplateSource} onChange={(e) => set("boilerplateSource", e.target.value)} className="font-mono text-xs" placeholder={"import java.util.*;\npublic class Main {\n    // ==== STUDENT CODE START ====\n    public static String maskCode(String code) {\n        return null;\n    }\n    // ==== STUDENT CODE END ====\n    public static void main(String[] args) { … }\n}"} />
                {errors.boilerplate_source && <p className="text-xs text-danger">{errors.boilerplate_source}</p>}
              </div>
            </Panel>
          )}

          <Panel>
            <PanelHeader title="Starter code (what the student sees)"
              actions={form.executionMode === "function" && sigState?.ok ? (
                <Button size="sm" onClick={() => { const t = buildFunctionTemplate(sigState.sig); set("starterCode", form.editableScope === "body" ? t.starterBody : t.starterMethod); }}>Generate from signature</Button>
              ) : undefined} />
            <div className="h-64"><CodeEditor value={form.starterCode} onChange={(v) => set("starterCode", v)} /></div>
          </Panel>

          <Panel>
            <PanelHeader title="Final program the runner will compile (starter code inserted into the trusted wrapper)" />
            <div className="p-4">
              {composed.ok ? <CodeViewer code={composed.source} maxHeight={360} /> : <p className="text-sm text-danger">{composed.message}</p>}
            </div>
          </Panel>

          <Panel className="grid gap-4 p-4 md:grid-cols-4">
            <Field label="Time limit per test (ms)"><Input type="number" min={100} max={15000} value={form.timeLimitMs} onChange={(e) => set("timeLimitMs", Number(e.target.value))} /></Field>
            <Field label="Memory limit (MB)"><Input type="number" min={32} max={1024} value={form.memoryLimitMb} onChange={(e) => set("memoryLimitMb", Number(e.target.value))} /></Field>
            <Field label="Output comparison" hint={{ exact: "Exact: case & spacing matter; trailing spaces/newlines ignored.", trim: "Like exact, ignoring outer whitespace.", tokens: "Whitespace-insensitive, case-sensitive.", float: "Numbers compared within tolerance." }[form.compareMode]}>
              <Select value={form.compareMode} onChange={(e) => set("compareMode", e.target.value as CodingForm["compareMode"])}><option value="exact">Exact (default)</option><option value="trim">Trim outer whitespace</option><option value="tokens">Token-by-token</option><option value="float">Floating point</option></Select>
            </Field>
            {form.compareMode === "float" && <Field label="Tolerance"><Input type="number" step="any" value={form.floatTolerance} onChange={(e) => set("floatTolerance", Number(e.target.value))} /></Field>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowCustomInput} onChange={(e) => set("allowCustomInput", e.target.checked)} /> Allow custom input on Run</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.revealHidden} onChange={(e) => set("revealHidden", e.target.checked)} /> Reveal hidden test details after Submit</label>
          </Panel>

          <Panel>
            <PanelHeader title="Reference solution (private)" />
            <div className="h-56" data-testid="reference-editor"><CodeEditor value={form.referenceSolution} onChange={(v) => set("referenceSolution", v)} /></div>
            <p className="border-t border-border px-4 py-2 text-xs text-muted">Stored privately. Use “Validate” on the last tab to check every test against it before publishing.</p>
          </Panel>
        </div>
      )}

      {tab === "tests" && (
        <div className="space-y-3">
          {form.gradingMode === "manual" && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">Manual grading: test cases are optional (public ones still power the Run button).</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => set("tests", [...form.tests, { input: "", expected_output: "", visibility: "public", weight: 1, label: "" }])}>+ Public test</Button>
            <Button size="sm" onClick={() => set("tests", [...form.tests, { input: "", expected_output: "", visibility: "hidden", weight: 1, label: "" }])}>+ Hidden test</Button>
            <Button size="sm" disabled={form.examples.length === 0} onClick={() => set("tests", [...form.tests, ...form.examples.map((e, i) => ({ input: e.input, expected_output: e.output, visibility: "public" as const, weight: 1, label: `Example ${i + 1}` }))])}>Add statement examples as public tests</Button>
            <span className="ml-auto text-sm text-muted">{publicCount} public · {hiddenCount} hidden</span>
          </div>
          {form.tests.length === 0 && <p className="rounded-md border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted">No tests yet. Public tests are visible to the student; hidden tests are only ever used for grading.</p>}
          {form.tests.map((t, i) => {
            const shape = sigState?.ok && form.gradingMode === "auto" ? checkTestInputShape(sigState.sig, t.input) : null;
            const upd = (patch: Partial<CodingForm["tests"][number]>) => set("tests", form.tests.map((x, k) => (k === i ? { ...x, ...patch } : x)));
            return (
              <Panel key={i} className={cn(t.visibility === "hidden" && "border-warning/50")}>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                  <span className="font-mono text-xs text-muted">#{i + 1}</span>
                  <Select className="w-28" value={t.visibility} onChange={(e) => upd({ visibility: e.target.value as "public" | "hidden" })}><option value="public">Public</option><option value="hidden">Hidden</option></Select>
                  <Input className="w-40" placeholder="Label (optional)" value={t.label} onChange={(e) => upd({ label: e.target.value })} />
                  <label className="flex items-center gap-1 text-xs text-muted">Weight <Input className="w-16" type="number" min={0.01} step="any" value={t.weight} onChange={(e) => upd({ weight: Number(e.target.value) })} /></label>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => { const a = [...form.tests]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set("tests", a); }}>↑</Button>
                    <Button size="sm" variant="ghost" disabled={i === form.tests.length - 1} onClick={() => { const a = [...form.tests]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set("tests", a); }}>↓</Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => set("tests", form.tests.filter((_, k) => k !== i))}>Delete</Button>
                  </div>
                </div>
                <div className="grid gap-3 p-3 md:grid-cols-2">
                  <Field label="Input (stdin)"><Textarea rows={3} className="font-mono text-xs" value={t.input} onChange={(e) => upd({ input: e.target.value })} /></Field>
                  <Field label="Expected output"><Textarea rows={3} className="font-mono text-xs" value={t.expected_output} onChange={(e) => upd({ expected_output: e.target.value })} /></Field>
                </div>
                {shape && <p className="border-t border-border px-3 py-1.5 text-xs text-danger">{shape}</p>}
              </Panel>
            );
          })}
        </div>
      )}

      {tab === "publish" && (
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Readiness checklist" />
            <ul className="space-y-1 p-4 text-sm">
              {checks.map((c) => (<li key={c.label} className="flex items-center gap-2"><span className={c.ok ? "text-success" : "text-danger"}>{c.ok ? "✓" : "✗"}</span>{c.label}</li>))}
              <li className="flex items-center gap-2"><span className={validated ? "text-success" : "text-warning"}>{validated ? "✓" : "○"}</span>
                {validated ? `Reference solution passes all ${report!.total} tests` : "Not yet validated against a reference solution (recommended)"}</li>
            </ul>
            {warnings.length > 0 && <ul className="list-disc space-y-0.5 border-t border-border px-8 py-3 text-sm text-warning">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </Panel>
          <Panel>
            <PanelHeader title="Validate with the reference solution" actions={<Button onClick={onValidate} disabled={pending || !form.referenceSolution.trim() || form.tests.length === 0}>{pending ? "Running…" : "Run all tests"}</Button>} />
            <div className="p-4 text-sm">
              {!form.referenceSolution.trim() && <p className="text-muted">Add a reference solution on the “Code setup” tab to enable validation.</p>}
              {report && (
                <div className="space-y-2">
                  <p><strong>{report.passed}/{report.total}</strong> tests passed · verdict <Badge>{report.verdict}</Badge></p>
                  {report.compileOutput && <pre className="code-block">{report.compileOutput}</pre>}
                  <table className="table-dense w-full text-xs">
                    <thead><tr><th>#</th><th>Visibility</th><th>Status</th><th>Expected</th><th>Actual</th></tr></thead>
                    <tbody>{report.tests.map((t, i) => (
                      <tr key={t.id}><td>{i + 1}</td><td>{t.visibility}</td><td className={t.status === "passed" ? "text-success" : "text-danger"}>{t.status}</td>
                        <td className="max-w-48 truncate font-mono">{t.expected}</td><td className="max-w-48 truncate font-mono">{t.actual ?? t.message ?? ""}</td></tr>))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Panel>
          {!ready && <p className="text-sm text-warning">Some checklist items are failing — publishing will be refused until they are fixed.</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={pending} onClick={onPublish}>{meta.status === "published" ? `Publish v${meta.version + (meta.versionPublished ? 1 : 0)}` : "Publish"}</Button>
            {meta.status === "published" && <Button onClick={() => onUnpublish(false)} disabled={pending}>Unpublish</Button>}
            {form.questionId && meta.status !== "archived" && <Button onClick={() => onUnpublish(true)} disabled={pending}>Archive</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
