"use server";

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { extractPdfText, validatePdfBytes, PdfValidationError } from "@/lib/import/pdf";
import { parseQuestions, type ParsedQuestion } from "@/lib/import/text-parser";
import { buildFunctionTemplate } from "@/lib/coding/harness";
import { parseSignature } from "@/lib/coding/signature";
import { codingDraftSchema, mcqDraftSchema } from "@/lib/validation/question";
import { prepareCoding } from "@/lib/coding/prepare";
import { toActionError, type ActionResult } from "./common";
import type { Json } from "@/lib/supabase/database.types";

export interface ImportPreview {
  importId: string;
  source: string;
  status: "parsed" | "needs_ocr" | "failed";
  message: string;
  pageCount: number;
  questions: ParsedQuestion[];
  warnings: string[];
}

/** Paste → parse. Stores the raw text for traceability; nothing becomes a question until the admin commits. */
export async function parsePastedText(text: string): Promise<ActionResult<{ preview: ImportPreview }>> {
  try {
    const admin = await assertAdmin();
    if (typeof text !== "string" || text.trim().length === 0) return { ok: false, error: "Paste some text first." };
    if (text.length > 400_000) return { ok: false, error: "That text is too long (limit 400,000 characters)." };
    const result = parseQuestions(text);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("imports")
      .insert({
        kind: "text",
        status: "parsed",
        raw_text: text,
        created_by: admin.id,
        extraction_metadata: { questions_found: result.questions.length, warnings: result.warnings } as NonNullable<Json>,
      })
      .select("id")
      .single();
    if (error) throw error;
    return {
      ok: true,
      preview: { importId: data.id, source: "Pasted text", status: "parsed", message: `Found ${result.questions.length} question(s).`, pageCount: 0, questions: result.questions, warnings: result.warnings },
    };
  } catch (e) {
    return toActionError(e);
  }
}

/** Upload one or more PDFs: validate → store privately → extract text → parse. Scanned PDFs are reported as needing OCR. */
export async function uploadPdfs(formData: FormData): Promise<ActionResult<{ previews: ImportPreview[] }>> {
  try {
    const admin = await assertAdmin();
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return { ok: false, error: "Choose at least one PDF." };
    if (files.length > 10) return { ok: false, error: "Upload at most 10 PDFs at a time." };
    const supabase = await createClient();
    const previews: ImportPreview[] = [];

    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        validatePdfBytes(bytes, file.name);
      } catch (e) {
        if (e instanceof PdfValidationError) {
          previews.push({ importId: "", source: file.name, status: "failed", message: e.message, pageCount: 0, questions: [], warnings: [] });
          continue;
        }
        throw e;
      }
      const path = `${randomUUID()}.pdf`;
      const up = await supabase.storage.from("imports").upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (up.error) throw up.error;

      const ex = await extractPdfText(bytes);
      const parsed = ex.status === "parsed" ? parseQuestions(ex.text) : { questions: [], warnings: [] as string[] };
      const { data, error } = await supabase
        .from("imports")
        .insert({
          kind: "pdf",
          file_name: file.name.slice(0, 200),
          storage_path: path,
          status: ex.status,
          page_count: ex.pageCount,
          raw_text: ex.text || null,
          created_by: admin.id,
          extraction_metadata: { chars_per_page: ex.charsPerPage, message: ex.message, questions_found: parsed.questions.length } as NonNullable<Json>,
        })
        .select("id")
        .single();
      if (error) throw error;
      previews.push({
        importId: data.id,
        source: file.name,
        status: ex.status,
        message: ex.status === "parsed" ? `${ex.message} Found ${parsed.questions.length} question(s).` : ex.message,
        pageCount: ex.pageCount,
        questions: parsed.questions,
        warnings: parsed.warnings,
      });
    }
    return { ok: true, previews };
  } catch (e) {
    return toActionError(e);
  }
}

export interface CommitItem {
  importId: string | null;
  question: ParsedQuestion;
}

/** Create DRAFT questions from the reviewed preview. Imports are never published automatically. */
export async function commitImport(items: CommitItem[], batchId: string): Promise<ActionResult<{ created: { questionId: string; type: "coding" | "mcq"; title: string }[] }>> {
  try {
    await assertAdmin();
    if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "Select at least one question to import." };
    if (items.length > 100) return { ok: false, error: "Import at most 100 questions at a time." };
    const supabase = await createClient();
    if (!z.string().uuid().safeParse(batchId).success) return { ok: false, error: "Invalid import batch." };
    const preparedItems: { type: "coding" | "mcq"; payload: Json }[] = [];

    for (const item of items) {
      const q = item.question;
      const importId = item.importId || null;
      if (q.kind === "mcq") {
        const parsed = mcqDraftSchema.safeParse({
          questionId: null,
          title: q.title || "Untitled question",
          difficulty: q.difficulty ?? "easy",
          topic: q.topic,
          tags: q.tags,
          company: q.company,
          statement_md: q.statement_md,
          marks: 1,
          explanation_md: q.explanation,
          review_flags: q.flags,
          import_id: importId,
          mcq_multi: q.multi,
          options: q.options.map((text, i) => ({ text, correct: q.correct.includes(i) })),
        });
        if (!parsed.success) return { ok: false, error: `"${q.title || "An MCQ"}": ${parsed.error.issues[0].message}` };
        const d = parsed.data;
        preparedItems.push({ type: "mcq", payload: {
          title: d.title, difficulty: d.difficulty, topic: d.topic, tags: d.tags, company: d.company, statement_md: d.statement_md,
          code_snippet: "", image_path: null, marks: d.marks, mcq_multi: d.mcq_multi, review_flags: d.review_flags,
          explanation_md: d.explanation_md, import_id: d.import_id ?? null, options: d.options,
        } as Json });
      } else {
        // Function mode when a valid signature was found, otherwise full-program mode (flagged).
        let mode: "function" | "program" = "program";
        let signature = "";
        try {
          signature = parseSignature(q.function_signature).declaration;
          mode = "function";
        } catch {
          mode = "program";
        }
        const flags = [...q.flags];
        if (mode === "program" && q.function_signature) {
          flags.push({ field: "function_signature", message: `The signature "${q.function_signature}" uses unsupported types — switched to full-program mode.` });
        }
        const starter = mode === "function" ? buildFunctionTemplate(parseSignature(signature)).starterMethod : "";
        const parsed = codingDraftSchema.safeParse({
          questionId: null,
          title: q.title || "Untitled problem",
          difficulty: q.difficulty ?? "easy",
          topic: q.topic,
          tags: q.tags,
          company: q.company,
          statement_md: q.statement_md,
          input_format: q.input_format,
          output_format: q.output_format,
          constraints_md: q.constraints_md,
          examples: q.examples,
          review_flags: flags,
          import_id: importId,
          config: { execution_mode: mode, function_signature: signature, starter_code: starter },
          // Public tests come straight from the statement's examples; the admin must still verify them.
          tests: q.examples
            .filter((e) => e.input !== "" || e.output !== "")
            .map((e, i) => ({ input: e.input, expected_output: e.output, visibility: "public" as const, label: `Example ${i + 1}` })),
        });
        if (!parsed.success) return { ok: false, error: `"${q.title || "A problem"}": ${parsed.error.issues[0].message}` };
        const prepared = prepareCoding(parsed.data);
        if (!prepared.ok) return { ok: false, error: `"${q.title}": ${prepared.error}` };
        preparedItems.push({ type: "coding", payload: prepared.payload as Json });
      }
    }
    const { data, error } = await supabase.rpc("commit_import_batch", { p_batch_id: batchId, p_items: preparedItems as unknown as Json });
    if (error) throw error;
    const created = data as unknown as { questionId: string; type: "coding" | "mcq"; title: string }[];
    revalidatePath("/admin/questions");
    return { ok: true, created };
  } catch (e) {
    return toActionError(e);
  }
}
