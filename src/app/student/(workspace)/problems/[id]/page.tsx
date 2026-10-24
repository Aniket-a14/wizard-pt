import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireStudent } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isExternalRunnerMode } from "@/lib/runner/mode";
import { isLang, LANGUAGES, type ExtraLang, type Lang, type VariantsPublic } from "@/lib/coding/languages";
import { ProblemWorkspace, type WorkspaceProblem, type SubmissionSummary } from "./workspace";

export const metadata = { title: "Problem" };

export default async function ProblemPage({ params, searchParams }: PageProps<"/student/problems/[id]">) {
  const user = await requireStudent();
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();

  const q = await supabase.from("questions").select("id, seq, status, published_version_id").eq("id", id).eq("type", "coding").maybeSingle();
  if (!q.data) notFound();

  // Which version to show: the one asked for (only if she has history on it), else the latest published.
  const { data: versions } = await supabase.from("question_versions").select("id, version, published_at").eq("question_id", id).not("published_at", "is", null).order("version", { ascending: false });
  const requested = typeof sp.v === "string" ? versions?.find((v) => v.version === Number(sp.v)) : undefined;
  const latestPublished = versions?.find((v) => v.id === q.data!.published_version_id);
  const current = requested ?? latestPublished ?? versions?.[0];
  if (!current) notFound();

  // Language: ?lang=… wins, then the student's remembered choice, then Java. Only enabled languages count.
  const cookieLang = (await cookies()).get("wpt-lang")?.value;
  const askedLang = typeof sp.lang === "string" ? sp.lang : cookieLang;
  const cfgForLangs = await supabase.from("coding_configs").select("variants").eq("question_version_id", current.id).single();
  const variants = ((cfgForLangs.data?.variants ?? {}) as VariantsPublic);
  const languages: Lang[] = LANGUAGES.filter((l) => l === "java" || l in variants); // Java, C++, C — a stable order
  const language: Lang = isLang(askedLang) && languages.includes(askedLang) ? askedLang : "java";

  const [v, cfg, tests, draft, subs, reviews] = await Promise.all([
    supabase.from("question_versions").select("id, version, title, difficulty, topic, tags, company, statement_md, input_format, output_format, constraints_md, examples, marks, est_minutes").eq("id", current.id).single(),
    supabase.from("coding_configs").select("execution_mode, grading_mode, editable_scope, function_signature, starter_code, time_limit_ms, memory_limit_mb, allow_custom_input").eq("question_version_id", current.id).single(),
    supabase.from("test_cases").select("id, input, expected_output, label, ordering").eq("question_version_id", current.id).eq("visibility", "public").order("ordering"),
    supabase.from("code_drafts").select("source_code, updated_at").eq("student_id", user.id).eq("question_version_id", current.id).eq("language", language).maybeSingle(),
    supabase.from("code_submissions").select("id, language, status, verdict, score_pct, passed_public, total_public, passed_hidden, total_hidden, exec_time_ms, submitted_at, question_version_id, v:question_versions!inner(question_id, version)").eq("student_id", user.id).eq("v.question_id", id).order("submitted_at", { ascending: false }).limit(30),
    supabase.from("reviews").select("code_submission_id").not("published_at", "is", null),
  ]);
  if (v.error || cfg.error) notFound();
  const reviewed = new Set((reviews.data ?? []).map((r) => r.code_submission_id));

  const problem: WorkspaceProblem = {
    questionId: id,
    versionId: current.id,
    version: v.data.version,
    latestVersion: latestPublished?.version ?? v.data.version,
    seq: q.data.seq,
    title: v.data.title,
    difficulty: v.data.difficulty,
    topic: v.data.topic,
    tags: v.data.tags,
    company: v.data.company,
    statement_md: v.data.statement_md,
    input_format: v.data.input_format,
    output_format: v.data.output_format,
    constraints_md: v.data.constraints_md,
    examples: (Array.isArray(v.data.examples) ? v.data.examples : []) as unknown as WorkspaceProblem["examples"],
    marks: Number(v.data.marks),
    estMinutes: v.data.est_minutes,
    executionMode: cfg.data.execution_mode as "function" | "program",
    gradingMode: cfg.data.grading_mode as "auto" | "manual",
    editableScope: cfg.data.editable_scope as "method" | "body",
    functionSignature: language === "java" ? cfg.data.function_signature : variants[language as ExtraLang]?.function_signature ?? null,
    starterCode: language === "java" ? cfg.data.starter_code : variants[language as ExtraLang]?.starter_code ?? "",
    language,
    languages,
    timeLimitMs: cfg.data.time_limit_ms,
    memoryLimitMb: cfg.data.memory_limit_mb,
    allowCustomInput: cfg.data.allow_custom_input,
    publicTests: (tests.data ?? []).map((t) => ({ id: t.id, input: t.input, expected: t.expected_output, label: t.label })),
    archived: q.data.status !== "published" || current.id !== q.data.published_version_id,
  };
  const submissions: SubmissionSummary[] = (subs.data ?? []).map((s) => ({
    id: s.id,
    status: s.status,
    verdict: s.verdict,
    scorePct: s.score_pct === null ? null : Number(s.score_pct),
    passedPublic: s.passed_public,
    totalPublic: s.total_public,
    passedHidden: s.passed_hidden,
    totalHidden: s.total_hidden,
    execTimeMs: s.exec_time_ms,
    submittedAt: s.submitted_at,
    version: s.v?.version ?? 1,
    language: isLang(s.language) ? s.language : "java",
    hasFeedback: reviewed.has(s.id),
  }));

  return <ProblemWorkspace key={`${current.id}:${language}`} problem={problem} initialCode={draft.data?.source_code ?? problem.starterCode} hasDraft={!!draft.data} submissions={submissions} externalRunner={isExternalRunnerMode()} />;
}
