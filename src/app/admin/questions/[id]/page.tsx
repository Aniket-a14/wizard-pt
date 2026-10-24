import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CodingEditor, EMPTY_CODING, type CodingForm } from "../coding-editor";
import { McqEditor, type McqForm } from "../mcq-editor";
import type { ValidationReport } from "@/lib/actions/questions";
import type { ImportFlag } from "@/lib/import/text-parser";

export const metadata = { title: "Edit question" };

export default async function EditQuestion({ params }: PageProps<"/admin/questions/[id]">) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const q = await supabase.from("questions").select("id, type, status, import_id, current_version_id, published_version_id").eq("id", id).maybeSingle();
  if (!q.data || !q.data.current_version_id) notFound();
  const vid = q.data.current_version_id;

  const [v, secrets, pub] = await Promise.all([
    supabase.from("question_versions").select("*").eq("id", vid).single(),
    supabase.from("question_secrets").select("explanation_md").eq("question_version_id", vid).maybeSingle(),
    q.data.published_version_id ? supabase.from("question_versions").select("version").eq("id", q.data.published_version_id).single() : Promise.resolve({ data: null }),
  ]);
  if (v.error) throw v.error;
  const ver = v.data;
  const flags = (Array.isArray(ver.review_flags) ? ver.review_flags : []) as unknown as ImportFlag[];

  if (q.data.type === "mcq") {
    const [opts, keys] = await Promise.all([
      supabase.from("mcq_options").select("id, option_text, display_order").eq("question_version_id", vid).order("display_order"),
      supabase.from("mcq_correct_options").select("option_id").eq("question_version_id", vid),
    ]);
    const correct = new Set((keys.data ?? []).map((k) => k.option_id));
    let imageUrl: string | null = null;
    if (ver.image_path) imageUrl = (await supabase.storage.from("question-assets").createSignedUrl(ver.image_path, 3600)).data?.signedUrl ?? null;
    const form: McqForm = {
      questionId: id, title: ver.title, difficulty: ver.difficulty as McqForm["difficulty"], topic: ver.topic ?? "", tagsText: ver.tags.join(", "),
      company: ver.company ?? "", marks: Number(ver.marks), statement_md: ver.statement_md, codeSnippet: ver.code_snippet ?? "",
      imagePath: ver.image_path, imageUrl, multi: ver.mcq_multi,
      options: (opts.data ?? []).map((o) => ({ text: o.option_text, correct: correct.has(o.id) })),
      explanation: secrets.data?.explanation_md ?? "", reviewFlags: flags, importId: q.data.import_id,
    };
    return <McqEditor key={vid} initial={form} status={q.data.status as "draft"} version={ver.version} versionPublished={!!ver.published_at} />;
  }

  const [cfg, sec, tests] = await Promise.all([
    supabase.from("coding_configs").select("*").eq("question_version_id", vid).maybeSingle(),
    supabase.from("coding_secrets").select("*").eq("question_version_id", vid).maybeSingle(),
    supabase.from("test_cases").select("*").eq("question_version_id", vid).order("ordering"),
  ]);
  const c = cfg.data;
  const form: CodingForm = {
    ...EMPTY_CODING,
    questionId: id, versionId: vid, title: ver.title, difficulty: ver.difficulty as CodingForm["difficulty"], topic: ver.topic ?? "",
    tagsText: ver.tags.join(", "), company: ver.company ?? "", marks: Number(ver.marks), estMinutes: ver.est_minutes?.toString() ?? "",
    statement_md: ver.statement_md, input_format: ver.input_format ?? "", output_format: ver.output_format ?? "", constraints_md: ver.constraints_md ?? "",
    examples: (Array.isArray(ver.examples) ? ver.examples : []) as unknown as CodingForm["examples"],
    explanation_md: secrets.data?.explanation_md ?? "",
    executionMode: (c?.execution_mode ?? "function") as CodingForm["executionMode"], gradingMode: (c?.grading_mode ?? "auto") as CodingForm["gradingMode"],
    functionSignature: c?.function_signature ?? "", editableScope: (c?.editable_scope ?? "method") as CodingForm["editableScope"], starterCode: c?.starter_code ?? "",
    boilerplateSource: sec.data?.boilerplate_source ?? "", referenceSolution: sec.data?.reference_solution ?? "",
    timeLimitMs: c?.time_limit_ms ?? 2000, memoryLimitMb: c?.memory_limit_mb ?? 256, compareMode: (c?.compare_mode ?? "exact") as CodingForm["compareMode"],
    floatTolerance: c?.float_tolerance ?? 1e-6, allowCustomInput: c?.allow_custom_input ?? true, revealHidden: c?.reveal_hidden ?? false,
    tests: (tests.data ?? []).map((t) => ({ input: t.input, expected_output: t.expected_output, visibility: t.visibility as "public" | "hidden", weight: Number(t.weight), label: t.label ?? "" })),
    reviewFlags: flags, importId: q.data.import_id,
  };
  return (
    <CodingEditor
      key={vid}
      initial={form}
      meta={{ status: q.data.status as "draft", version: ver.version, versionPublished: !!ver.published_at, publishedVersion: pub.data?.version ?? null, lastValidation: (sec.data?.last_validation as unknown as ValidationReport | null) ?? null }}
    />
  );
}
