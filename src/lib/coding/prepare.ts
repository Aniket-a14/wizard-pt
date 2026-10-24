import type { CodingDraft } from "@/lib/validation/question";
import { buildFunctionTemplate, parseBoilerplate, BoilerplateError } from "./harness";
import { checkTestInputShape, parseSignature, SignatureError } from "./signature";

export type PrepareResult =
  | { ok: true; payload: Record<string, unknown>; warnings: string[] }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

const PROGRAM_STARTER = `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        // Write your solution here
    }
}
`;

/**
 * Turn the admin's form state into the trusted stored configuration:
 * validated signature, generated (or boilerplate-split) wrapper prefix/suffix, starter code.
 * Pure + deterministic so it can be unit-tested without a server.
 */
export function prepareCoding(d: CodingDraft): PrepareResult {
  const fieldErrors: Record<string, string> = {};
  const warnings: string[] = [];
  const c = d.config;
  let prefix = "";
  let suffix = "";
  let starter = c.starter_code;
  let signature: string | null = null;

  if (c.execution_mode === "function") {
    try {
      const sig = parseSignature(c.function_signature);
      signature = sig.declaration;
      if (d.boilerplate_source.trim()) {
        const bp = parseBoilerplate(d.boilerplate_source);
        prefix = bp.prefix;
        suffix = bp.suffix;
        if (!starter.trim()) starter = bp.starter;
      } else {
        const tpl = buildFunctionTemplate(sig);
        prefix = tpl.prefix;
        suffix = tpl.suffix;
        if (!starter.trim()) starter = c.editable_scope === "body" ? tpl.starterBody : tpl.starterMethod;
      }
      if (c.editable_scope === "method" && !new RegExp(`\\b${sig.name.replace(/\$/g, "\\$")}\\s*\\(`).test(starter)) {
        warnings.push(`The starter code does not contain the method "${sig.name}".`);
      }
      if (c.grading_mode === "auto") {
        d.tests.forEach((t, i) => {
          const problem = checkTestInputShape(sig, t.input);
          if (problem) warnings.push(`Test ${i + 1} (${t.visibility}): ${problem}`);
        });
      }
    } catch (e) {
      if (e instanceof SignatureError) fieldErrors["config.function_signature"] = e.message;
      else if (e instanceof BoilerplateError) fieldErrors["boilerplate_source"] = e.message;
      else throw e;
    }
  } else {
    if (!starter.trim()) starter = PROGRAM_STARTER;
    if (!/\bclass\s+Main\b/.test(starter)) warnings.push("Full-program mode: the starter code should declare `public class Main`.");
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: Object.values(fieldErrors)[0], fieldErrors };
  }

  return {
    ok: true,
    warnings,
    payload: {
      title: d.title,
      difficulty: d.difficulty,
      topic: d.topic,
      tags: d.tags,
      company: d.company,
      statement_md: d.statement_md,
      input_format: d.input_format,
      output_format: d.output_format,
      constraints_md: d.constraints_md,
      examples: d.examples,
      marks: d.marks,
      est_minutes: d.est_minutes,
      review_flags: d.review_flags,
      explanation_md: d.explanation_md,
      import_id: d.import_id ?? null,
      config: { ...c, function_signature: signature ?? "", starter_code: starter },
      secrets: {
        template_prefix: prefix,
        template_suffix: suffix,
        boilerplate_source: d.boilerplate_source,
        reference_solution: d.reference_solution,
      },
      tests: d.tests.map((t) => ({
        input: t.input,
        expected_output: t.expected_output,
        visibility: t.visibility,
        weight: t.weight,
        label: t.label ?? null,
      })),
    },
  };
}
