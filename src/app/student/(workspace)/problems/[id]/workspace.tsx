"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { toast } from "sonner";
import { CodeEditor, type EditorTheme } from "@/components/code-editor";
import { Badge, DifficultyBadge, VerdictBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/form";
import { saveDraft } from "@/lib/actions/drafts";
import { LANG_META, type Lang } from "@/lib/coding/languages";
import { VERDICT_LABEL, type Verdict } from "@/lib/coding/score";
import { cn, formatDateTime } from "@/lib/utils";

export interface WorkspaceProblem {
  questionId: string;
  versionId: string;
  version: number;
  latestVersion: number;
  seq: number;
  title: string;
  difficulty: string;
  topic: string | null;
  tags: string[];
  company: string | null;
  statement_md: string;
  input_format: string | null;
  output_format: string | null;
  constraints_md: string | null;
  examples: { input: string; output: string; explanation?: string }[];
  marks: number;
  estMinutes: number | null;
  executionMode: "function" | "program";
  gradingMode: "auto" | "manual";
  editableScope: "method" | "body";
  functionSignature: string | null;
  starterCode: string;
  /** The language being edited, and every language this problem accepts. */
  language: Lang;
  languages: Lang[];
  timeLimitMs: number;
  memoryLimitMb: number;
  allowCustomInput: boolean;
  publicTests: { id: string; input: string; expected: string; label: string | null }[];
  archived: boolean;
}

export interface SubmissionSummary {
  id: string;
  status: string;
  verdict: string | null;
  scorePct: number | null;
  passedPublic: number | null;
  totalPublic: number | null;
  passedHidden: number | null;
  totalHidden: number | null;
  execTimeMs: number | null;
  submittedAt: string;
  version: number;
  language: Lang;
  hasFeedback: boolean;
}

interface TestView {
  testId: string;
  visibility: "public" | "hidden";
  status: string;
  timeMs: number | null;
  index: number;
  input?: string;
  expected?: string;
  actual?: string | null;
  studentStdout?: string;
  stderr?: string;
  message?: string;
}

interface RunOutcome {
  kind: "run" | "submit";
  verdict: string | null;
  compileOutput: string | null;
  passedPublic: number;
  totalPublic: number;
  passedHidden?: number | null;
  totalHidden?: number | null;
  scorePct?: number | null;
  execTimeMs: number | null;
  results: TestView[];
  custom?: { status: string; output: string | null; studentStdout: string; stderr: string; compileOutput: string | null; timeMs: number | null };
  submissionId?: string;
  error?: string;
  unavailable?: boolean;
  /** Submitted in external-runner mode: saved, waiting for the instructor's evaluation. */
  pending?: boolean;
}

const STATUS_STYLE: Record<string, string> = { passed: "text-success", wrong_answer: "text-danger", runtime_error: "text-danger", time_limit: "text-danger", memory_limit: "text-danger", compile_error: "text-danger", system_error: "text-warning" };
const STATUS_LABEL: Record<string, string> = { passed: "Passed", wrong_answer: "Wrong answer", runtime_error: "Runtime error", time_limit: "Time limit exceeded", memory_limit: "Memory limit exceeded", compile_error: "Compilation error", system_error: "Not evaluated", not_run: "Not run" };

export function ProblemWorkspace({ problem: p, initialCode, hasDraft, submissions: initialSubs, externalRunner }: { problem: WorkspaceProblem; initialCode: string; hasDraft: boolean; submissions: SubmissionSummary[]; externalRunner: boolean }) {
  const [code, setCode] = useState(initialCode);
  const [tab, setTab] = useState<"description" | "results" | "submissions">("description");
  const [theme, setTheme] = useState<EditorTheme>("vs-dark");
  const [fontSize, setFontSize] = useState(14);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">(hasDraft ? "saved" : "saved");
  const [busy, setBusy] = useState<null | "run" | "submit">(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [subs, setSubs] = useState(initialSubs);
  const [customOpen, setCustomOpen] = useState(false);
  const [customInput, setCustomInput] = useState(p.publicTests[0]?.input ?? "");
  const [narrow, setNarrow] = useState(false);
  const router = useRouter();
  const codeRef = useRef(code);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);
  const lastSaved = useRef(initialCode);

  useEffect(() => {
    try {
      const t = localStorage.getItem("wpt-editor-theme");
      // Browser-only preferences can only be read after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (t === "light" || t === "vs-dark") setTheme(t);
      const f = Number(localStorage.getItem("wpt-editor-font"));
      if (f >= 10 && f <= 24) setFontSize(f);
    } catch {}
    const mq = window.matchMedia("(max-width: 900px)");
    const upd = () => setNarrow(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  // ---- autosave (debounced) + flush on leave
  const persist = useCallback(async () => {
    if (codeRef.current === lastSaved.current) return;
    const snapshot = codeRef.current;
    setSaveState("saving");
    const r = await saveDraft({ versionId: p.versionId, code: snapshot, language: p.language });
    if (r.ok) {
      lastSaved.current = snapshot;
      setSaveState(codeRef.current === snapshot ? "saved" : "unsaved");
    } else setSaveState("error");
  }, [p.versionId, p.language]);

  useEffect(() => {
    if (code === lastSaved.current) return;
    setSaveState("unsaved");
    const t = setTimeout(() => void persist(), 1500);
    return () => clearTimeout(t);
  }, [code, persist]);

  useEffect(() => {
    const h = () => {
      if (codeRef.current !== lastSaved.current) {
        // Best-effort synchronous-ish flush when leaving the page.
        void persist();
      }
    };
    const onBefore = (e: BeforeUnloadEvent) => {
      if (codeRef.current !== lastSaved.current) {
        h();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBefore);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && h());
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [persist]);

  // ---- run / submit
  const run = useCallback(
    async (withCustom: boolean) => {
      if (busy || externalRunner) return;
      setBusy("run");
      setTab("results");
      setOutcome(null);
      try {
        const res = await fetch("/api/code/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: p.versionId, code: codeRef.current, language: p.language, customInput: withCustom ? customInput : undefined }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setOutcome({ kind: "run", verdict: null, compileOutput: null, passedPublic: 0, totalPublic: 0, execTimeMs: null, results: [], error: data.error ?? "Run failed", unavailable: res.status === 503 });
        } else if (data.mode === "custom") {
          setOutcome({ kind: "run", verdict: null, compileOutput: data.custom.compileOutput, passedPublic: 0, totalPublic: 0, execTimeMs: data.custom.timeMs, results: [], custom: data.custom });
        } else {
          const r = data.result;
          setOutcome({ kind: "run", verdict: r.verdict, compileOutput: r.compileOutput, passedPublic: r.passed, totalPublic: r.total, execTimeMs: r.execTimeMs, results: r.results });
        }
      } catch {
        setOutcome({ kind: "run", verdict: null, compileOutput: null, passedPublic: 0, totalPublic: 0, execTimeMs: null, results: [], error: "Network error — nothing was run. Check your connection and try again." });
      } finally {
        setBusy(null);
      }
    },
    [busy, customInput, p.versionId, p.language, externalRunner],
  );

  const submitKey = useRef<string | null>(null);
  const submit = useCallback(async () => {
    if (busy) return;
    if (!confirm(externalRunner
      ? "Submit your solution for review? This creates a permanent submission that your instructor will evaluate against all tests."
      : "Submit your solution? This creates a permanent submission that is graded against all tests and shared with your instructor.")) return;
    setBusy("submit");
    setTab("results");
    setOutcome(null);
    await persist();
    // One idempotency key per click-through so network retries / double clicks can never create duplicates.
    submitKey.current = submitKey.current ?? crypto.randomUUID();
    try {
      const res = await fetch("/api/code/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: p.versionId, code: codeRef.current, language: p.language, idempotencyKey: submitKey.current }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        submitKey.current = null;
        setOutcome({ kind: "submit", verdict: null, compileOutput: null, passedPublic: 0, totalPublic: 0, execTimeMs: null, results: [], error: data.error ?? "Submission failed" });
        setBusy(null);
        return;
      }
      const id: string = data.submissionId;
      if (data.external) {
        // Nothing is graded here: the submission is saved and the instructor evaluates it.
        submitKey.current = null;
        setOutcome({ kind: "submit", verdict: null, compileOutput: null, passedPublic: 0, totalPublic: 0, execTimeMs: null, results: [], submissionId: id, pending: true });
        setSubs((cur) => [{ id, status: "queued", verdict: null, scorePct: null, passedPublic: null, totalPublic: null, passedHidden: null, totalHidden: null, execTimeMs: null, submittedAt: new Date().toISOString(), version: p.version, language: p.language, hasFeedback: false }, ...cur.filter((x) => x.id !== id)]);
        toast.success("Submitted — your instructor will evaluate it");
        router.refresh(); // lists and counts elsewhere must not serve a cached copy
        setBusy(null);
        return;
      }
      setOutcome({ kind: "submit", verdict: null, compileOutput: null, passedPublic: 0, totalPublic: 0, execTimeMs: null, results: [], submissionId: id });
      await pollSubmission(id);
    } catch {
      setOutcome({ kind: "submit", verdict: null, compileOutput: null, passedPublic: 0, totalPublic: 0, execTimeMs: null, results: [], error: "Network error. If your submission went through it will appear under Submissions." });
      setBusy(null);
    }

    async function pollSubmission(id: string) {
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, i < 5 ? 700 : 1500));
        try {
          const res = await fetch(`/api/code/submissions/${id}`, { cache: "no-store" });
          if (!res.ok) continue;
          const { submission: s } = await res.json();
          if (s.status === "completed" || s.status === "system_error") {
            submitKey.current = null;
            setOutcome({
              kind: "submit",
              verdict: s.verdict,
              compileOutput: s.compile_output,
              passedPublic: s.passed_public ?? 0,
              totalPublic: s.total_public ?? 0,
              passedHidden: s.passed_hidden,
              totalHidden: s.total_hidden,
              scorePct: s.score_pct === null ? null : Number(s.score_pct),
              execTimeMs: s.exec_time_ms,
              results: s.results ?? [],
              submissionId: id,
              error: s.status === "system_error" ? s.error_message ?? "Evaluation unavailable." : undefined,
              unavailable: s.status === "system_error",
            });
            setSubs((cur) => [{ id, status: s.status, verdict: s.verdict, scorePct: s.score_pct === null ? null : Number(s.score_pct), passedPublic: s.passed_public, totalPublic: s.total_public, passedHidden: s.passed_hidden, totalHidden: s.total_hidden, execTimeMs: s.exec_time_ms, submittedAt: s.submitted_at, version: p.version, language: p.language, hasFeedback: false }, ...cur.filter((x) => x.id !== id)]);
            if (s.status === "completed") toast.success(`Submitted — ${VERDICT_LABEL[s.verdict as Verdict] ?? s.verdict}`);
            router.refresh();
            setBusy(null);
            return;
          }
        } catch {
          /* keep polling */
        }
      }
      setOutcome((o) => ({ ...(o ?? { kind: "submit", verdict: null, compileOutput: null, passedPublic: 0, totalPublic: 0, execTimeMs: null, results: [] }), error: "Still evaluating. Your submission is saved — check the Submissions tab in a moment." }));
      setBusy(null);
    }
  }, [busy, p.versionId, p.version, p.language, persist, externalRunner, router]);

  async function retryEvaluation(id: string) {
    const res = await fetch(`/api/code/submissions/${id}`, { method: "POST" });
    if (!res.ok) return void toast.error("Could not retry right now.");
    setBusy("submit");
    setOutcome({ kind: "submit", verdict: null, compileOutput: null, passedPublic: 0, totalPublic: 0, execTimeMs: null, results: [], submissionId: id });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await fetch(`/api/code/submissions/${id}`, { cache: "no-store" });
      if (!r.ok) continue;
      const { submission: s } = await r.json();
      if (s.status === "completed" || s.status === "system_error") {
        setOutcome({ kind: "submit", verdict: s.verdict, compileOutput: s.compile_output, passedPublic: s.passed_public ?? 0, totalPublic: s.total_public ?? 0, passedHidden: s.passed_hidden, totalHidden: s.total_hidden, scorePct: s.score_pct === null ? null : Number(s.score_pct), execTimeMs: s.exec_time_ms, results: s.results ?? [], submissionId: id, error: s.status === "system_error" ? s.error_message : undefined, unavailable: s.status === "system_error" });
        break;
      }
    }
    setBusy(null);
  }

  async function copyProgram() {
    try {
      const res = await fetch("/api/code/program", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: p.versionId, code: codeRef.current, language: p.language }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return void toast.error(data.error ?? "Could not build the program.");
      await navigator.clipboard.writeText(data.source);
      toast.success(`Full program copied — paste it into an online ${LANG_META[p.language].label} compiler`);
    } catch {
      toast.error("Could not copy. Check your connection and clipboard permission.");
    }
  }

  function onReset() {
    if (!confirm("Reset to the starter code? Your current code will be replaced.")) return;
    setCode(p.starterCode);
  }
  function setThemePersist(t: EditorTheme) {
    setTheme(t);
    try { localStorage.setItem("wpt-editor-theme", t); } catch {}
  }
  function bumpFont(d: number) {
    setFontSize((f) => {
      const n = Math.max(10, Math.min(24, f + d));
      try { localStorage.setItem("wpt-editor-font", String(n)); } catch {}
      return n;
    });
  }

  const runRef = useRef(run);
  const submitRef = useRef(submit);
  useEffect(() => {
    runRef.current = run;
    submitRef.current = submit;
  });

  const [header, footer] = useMemo(() => {
    if (p.executionMode === "function" && p.editableScope === "body" && p.functionSignature) return [`${p.functionSignature} {`, "}"];
    return [null, null];
  }, [p]);

  const description = (
    <div className="space-y-4 p-4">
      {p.version !== p.latestVersion && (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          You&apos;re viewing version {p.version}. A newer version ({p.latestVersion}) exists. <Link className="underline" href={`/student/problems/${p.questionId}`}>Switch to the latest</Link>
        </p>
      )}
      {p.archived && p.version === p.latestVersion && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">This problem is no longer published. You can review it, but new submissions may not be accepted by your instructor.</p>}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{p.title}</h1>
          <DifficultyBadge level={p.difficulty} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {p.topic && <span>{p.topic}</span>}{p.company && <span>{p.company}</span>}<span>{p.marks} marks</span>
          {p.estMinutes && <span>~{p.estMinutes} min</span>}<span>{LANG_META[p.language].label}</span><span>{p.timeLimitMs / 1000}s · {p.memoryLimitMb} MB per test</span>
        </div>
      </div>
      <Markdown>{p.statement_md}</Markdown>
      {p.functionSignature && p.executionMode === "function" && (
        <Section title="Function signature"><pre className="code-block">{p.functionSignature}</pre></Section>
      )}
      {p.input_format && <Section title="Input format"><p className="whitespace-pre-wrap">{p.input_format}</p></Section>}
      {p.output_format && <Section title="Output format"><p className="whitespace-pre-wrap">{p.output_format}</p></Section>}
      {p.constraints_md && <Section title="Constraints"><p className="whitespace-pre-wrap font-mono text-[13px]">{p.constraints_md}</p></Section>}
      {p.examples.length > 0 && (
        <Section title="Examples">
          <div className="space-y-3">
            {p.examples.map((e, i) => (
              <div key={i} className="rounded-md border border-border">
                <div className="border-b border-border bg-surface-2 px-3 py-1 text-xs font-medium text-muted">Example {i + 1}</div>
                <div className="grid gap-3 p-3 sm:grid-cols-2">
                  <div><div className="mb-1 text-xs text-muted">Input</div><pre className="code-block">{e.input}</pre></div>
                  <div><div className="mb-1 text-xs text-muted">Output</div><pre className="code-block">{e.output}</pre></div>
                </div>
                {e.explanation && <p className="border-t border-border px-3 py-2 text-sm text-muted">{e.explanation}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );

  const left = (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div role="tablist" className="flex shrink-0 border-b border-border">
        {([["description", "Description"], ["results", "Test Results"], ["submissions", `Submissions (${subs.length})`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === id ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-foreground")}>{label}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "description" && description}
        {tab === "results" && <ResultsPanel outcome={outcome} busy={busy} tests={p.publicTests} onRetry={retryEvaluation} externalRunner={externalRunner} language={p.language} />}
        {tab === "submissions" && <SubmissionsPanel subs={subs} />}
      </div>
    </div>
  );

  const right = (
    <div className="flex h-full min-h-0 flex-col" style={{ background: theme === "vs-dark" ? "var(--code-bg)" : "var(--surface)" }}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
        <LanguagePicker problem={p} flush={persist} />
        <span className="text-xs text-muted" aria-live="polite">{saveState === "saved" ? "Draft saved" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save draft — will retry" : "Unsaved changes"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => bumpFont(-1)} aria-label="Smaller font">A−</Button>
          <Button size="sm" variant="ghost" onClick={() => bumpFont(1)} aria-label="Larger font">A+</Button>
          <Button size="sm" variant="ghost" onClick={() => setThemePersist(theme === "vs-dark" ? "light" : "vs-dark")}>{theme === "vs-dark" ? "Light" : "Dark"}</Button>
          <Button size="sm" variant="ghost" onClick={onReset}>Reset</Button>
          {externalRunner ? (
            <>
              <Button size="sm" onClick={() => void copyProgram()} title={`Copy the complete runnable ${LANG_META[p.language].file}`}>Copy program</Button>
              <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy !== null} title="Submit for review (Ctrl/Cmd+Shift+Enter)">{busy === "submit" ? "Submitting…" : "Submit for review"}</Button>
            </>
          ) : (
            <>
              {p.allowCustomInput && p.gradingMode === "auto" && <Button size="sm" variant="ghost" onClick={() => setCustomOpen((o) => !o)} aria-expanded={customOpen}>Custom input</Button>}
              <Button size="sm" onClick={() => void run(false)} disabled={busy !== null || (p.publicTests.length === 0)} title="Run public tests (Ctrl/Cmd+Enter)">{busy === "run" ? "Running…" : "Run"}</Button>
              <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy !== null} title="Submit (Ctrl/Cmd+Shift+Enter)">{busy === "submit" ? "Evaluating…" : "Submit"}</Button>
            </>
          )}
        </div>
      </div>
      {header && <pre className="shrink-0 border-b border-border/30 px-4 py-1.5 font-mono text-[13px] opacity-70" style={{ color: theme === "vs-dark" ? "var(--code-fg)" : "var(--foreground)", fontSize }}>{header}</pre>}
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={code}
          onChange={setCode}
          theme={theme}
          fontSize={fontSize}
          ariaLabel={`${LANG_META[p.language].label} code editor`}
          language={LANG_META[p.language].monaco}
          onMount={(editor, monaco) => {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runRef.current(false));
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => void submitRef.current());
          }}
        />
      </div>
      {footer && <pre className="shrink-0 border-t border-border/30 px-4 py-1.5 font-mono text-[13px] opacity-70" style={{ color: theme === "vs-dark" ? "var(--code-fg)" : "var(--foreground)", fontSize }}>{footer}</pre>}
      {customOpen && (
        <div className="shrink-0 space-y-2 border-t border-border bg-surface p-3">
          <label className="block text-xs font-medium text-muted">Custom input (stdin){p.executionMode === "function" ? " — one line per parameter, same format as the examples" : ""}</label>
          <Textarea rows={3} className="font-mono text-xs" value={customInput} onChange={(e) => setCustomInput(e.target.value)} />
          <Button size="sm" onClick={() => void run(true)} disabled={busy !== null}>Run with custom input</Button>
        </div>
      )}
    </div>
  );

  if (narrow) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="max-h-[50vh] overflow-y-auto border-b border-border">{left}</div>
        <div className="h-[75vh]">{right}</div>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1" style={{ height: "calc(100vh - 3rem)" }}>
      <Group orientation="horizontal" className="h-full w-full">
        <Panel defaultSize="42" minSize="25">{left}</Panel>
        <Separator className="w-1.5 bg-border transition-colors hover:bg-accent data-[separator=active]:bg-accent" />
        <Panel defaultSize="58" minSize="30">{right}</Panel>
      </Group>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ResultsPanel({ outcome, busy, tests, onRetry, externalRunner, language }: { language: Lang; outcome: RunOutcome | null; busy: null | "run" | "submit"; tests: WorkspaceProblem["publicTests"]; onRetry: (id: string) => void; externalRunner: boolean }) {
  if (busy && !outcome?.verdict) {
    return <div className="p-6 text-sm text-muted" role="status">{busy === "run" ? "Compiling and running your code in an isolated sandbox…" : "Evaluating your submission against all tests…"}</div>;
  }
  if (outcome?.pending) {
    return (
      <div className="space-y-2 p-4 text-sm" role="status">
        <div className="rounded-lg border border-border p-4">
          <div className="text-lg font-semibold">Submitted for review</div>
          <p className="mt-1 text-muted">Your code is saved exactly as submitted. Your instructor will evaluate it against all tests — you&apos;ll get a notification when it&apos;s graded. You can follow it under <b>Submissions</b>.</p>
        </div>
      </div>
    );
  }
  if (!outcome) {
    return (
      <div className="space-y-3 p-4 text-sm">
        {externalRunner ? (
          <div className="space-y-1 rounded-md bg-surface-2 p-3 text-muted">
            <p className="font-medium text-foreground">How to test your code</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Press <b>Copy program</b> (top right of the editor) and paste it into any online {LANG_META[language].label} compiler.</li>
              <li>Paste a sample input below into the compiler&apos;s <b>stdin / input</b> box and run it.</li>
              <li>Your answer is the text between the <code>@@WPT_RESULT_BEGIN@@</code> and <code>@@WPT_RESULT_END@@</code> lines. Compare it with <b>Expected</b>.</li>
              <li>Paste your final code back here (only the part you edit) and press <b>Submit for review</b>.</li>
            </ol>
          </div>
        ) : (
          <p className="text-muted">Run executes the sample tests below. Submit creates a permanent submission graded against all tests.</p>
        )}
        {tests.map((t, i) => (
          <div key={t.id} className="rounded-md border border-border p-3">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted"><span>Sample {i + 1}</span>{externalRunner && <CopyText text={t.input} label="Copy input" />}</div>
            <pre className="code-block">{t.input}</pre>
            <div className="my-1 text-xs text-muted">Expected</div>
            <pre className="code-block">{t.expected}</pre>
          </div>
        ))}
      </div>
    );
  }
  const v = outcome.verdict as Verdict | null;
  return (
    <div className="space-y-4 p-4 text-sm">
      {outcome.error && (
        <div className="rounded-md bg-warning-soft px-3 py-2 text-warning">
          {outcome.error}
          {outcome.unavailable && outcome.submissionId && <button className="ml-2 underline" onClick={() => onRetry(outcome.submissionId!)}>Retry evaluation</button>}
        </div>
      )}
      {outcome.custom && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted">Custom run · {STATUS_LABEL[outcome.custom.status] ?? (outcome.custom.status === "ok" ? "Finished" : outcome.custom.status)}{outcome.custom.timeMs != null && ` · ${outcome.custom.timeMs} ms`}</div>
          {outcome.custom.compileOutput && <pre className="code-block text-red-300">{outcome.custom.compileOutput}</pre>}
          {outcome.custom.output !== null && (<><div className="text-xs text-muted">Output</div><pre className="code-block">{outcome.custom.output || "(empty)"}</pre></>)}
          {outcome.custom.studentStdout && (<><div className="text-xs text-muted">Your prints</div><pre className="code-block">{outcome.custom.studentStdout}</pre></>)}
          {outcome.custom.stderr && <pre className="code-block text-red-300">{outcome.custom.stderr}</pre>}
        </div>
      )}
      {v && (
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{outcome.kind === "submit" ? "Submission result" : "Run result"}</span>
            <VerdictBadge verdict={v} />
          </div>
          <div className={cn("mt-2 text-lg font-semibold", v === "accepted" ? "text-success" : v === "partial" ? "text-warning" : v === "system_error" ? "text-warning" : "text-danger")}>{VERDICT_LABEL[v] ?? v}</div>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted">{outcome.kind === "run" ? "Sample tests" : "Public tests"}</dt><dd className="tabular-nums">{outcome.passedPublic}/{outcome.totalPublic} passed</dd></div>
            {outcome.kind === "submit" && outcome.totalHidden != null && <div><dt className="text-xs text-muted">Hidden tests</dt><dd className="tabular-nums">{outcome.passedHidden ?? 0}/{outcome.totalHidden} passed</dd></div>}
            {outcome.kind === "submit" && outcome.scorePct != null && <div><dt className="text-xs text-muted">Score</dt><dd className="tabular-nums">{outcome.scorePct}%</dd></div>}
            {outcome.execTimeMs != null && <div><dt className="text-xs text-muted">Execution time</dt><dd className="tabular-nums">{outcome.execTimeMs} ms</dd></div>}
          </dl>
          {outcome.kind === "run" && <p className="mt-2 text-xs text-muted">This was only a run — nothing was submitted.</p>}
        </div>
      )}
      {outcome.compileOutput && (<div><div className="mb-1 text-xs font-medium text-danger">Compilation output</div><pre className="code-block text-red-300">{outcome.compileOutput}</pre></div>)}
      {outcome.results.map((r) => <TestCard key={r.testId} r={r} />)}
    </div>
  );
}

function CopyText({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      className="rounded px-1.5 py-0.5 text-xs text-accent hover:bg-surface-2"
      onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"), () => toast.error("Could not copy"))}
    >
      {label}
    </button>
  );
}

function TestCard({ r }: { r: TestView }) {
  const label = r.visibility === "hidden" ? `Hidden test ${r.index}` : `Test ${r.index}`;
  return (
    <details className="rounded-md border border-border" open={r.visibility === "public" && r.status !== "passed"}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
        <span className={cn("font-medium", STATUS_STYLE[r.status])}>{r.status === "passed" ? "✓" : "✗"} {label}</span>
        <span className={cn("text-xs", STATUS_STYLE[r.status])}>{STATUS_LABEL[r.status] ?? r.status}</span>
        {r.timeMs != null && <span className="ml-auto text-xs text-muted tabular-nums">{r.timeMs} ms</span>}
      </summary>
      {r.visibility === "public" || r.input !== undefined ? (
        <div className="space-y-2 border-t border-border p-3">
          {r.input !== undefined && (<><div className="text-xs text-muted">Input</div><pre className="code-block">{r.input}</pre></>)}
          {r.expected !== undefined && (<><div className="text-xs text-muted">Expected</div><pre className="code-block">{r.expected}</pre></>)}
          {r.actual != null && (<><div className="text-xs text-muted">Your output</div><pre className="code-block">{r.actual || "(empty)"}</pre></>)}
          {r.studentStdout && (<><div className="text-xs text-muted">Your prints</div><pre className="code-block">{r.studentStdout}</pre></>)}
          {r.stderr && <pre className="code-block text-red-300">{r.stderr}</pre>}
          {r.message && <p className="text-xs text-muted">{r.message}</p>}
        </div>
      ) : (
        <p className="border-t border-border px-3 py-2 text-xs text-muted">Details of hidden tests are not shown.</p>
      )}
    </details>
  );
}

function SubmissionsPanel({ subs }: { subs: SubmissionSummary[] }) {
  if (subs.length === 0) return <p className="p-6 text-sm text-muted">No submissions yet.</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {subs.map((s) => (
        <li key={s.id}>
          <Link href={`/student/submissions/${s.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2">
            <VerdictBadge verdict={s.status === "completed" || s.status === "system_error" ? s.verdict : null} />
            <span className="tabular-nums">{s.scorePct === null ? "—" : `${s.scorePct}%`}</span>
            <span className="text-xs text-muted">{s.passedPublic ?? 0}/{s.totalPublic ?? 0} public · {s.passedHidden ?? 0}/{s.totalHidden ?? 0} hidden</span>
            {s.hasFeedback && <Badge tone="accent">feedback</Badge>}
            {s.version > 1 && <span className="text-xs text-muted">v{s.version}</span>}
            <Badge>{LANG_META[s.language].label}</Badge>
            <span className="ml-auto text-xs text-muted">{formatDateTime(s.submittedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Switch the language: save the current draft first, remember the choice, then reload the workspace for it. */
function LanguagePicker({ problem: p, flush }: { problem: WorkspaceProblem; flush: () => Promise<void> }) {
  const router = useRouter();
  if (p.languages.length < 2) return <Badge>{LANG_META[p.language].label}</Badge>;
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      Language
      <select
        aria-label="Programming language"
        className="h-7 rounded-md border border-border-strong bg-surface px-1.5 text-sm text-foreground"
        value={p.language}
        onChange={async (e) => {
          const next = e.target.value as Lang;
          await flush();
          try { document.cookie = `wpt-lang=${next}; path=/; max-age=31536000; samesite=lax`; } catch {}
          router.replace(`?lang=${next}`);
        }}
      >
        {p.languages.map((l) => <option key={l} value={l}>{LANG_META[l].label}</option>)}
      </select>
    </label>
  );
}
