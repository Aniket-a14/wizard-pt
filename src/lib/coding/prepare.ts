import type { CodingDraft } from "@/lib/validation/question";
import { buildFunctionTemplate, parseBoilerplate, BoilerplateError } from "./harness";
import { buildCTemplate, cDeclaration } from "./harness-c";
import { buildCppTemplate, cppDeclaration } from "./harness-cpp";
import { EXTRA_LANGUAGES, LANG_META, type ExtraLang, type VariantsPublic, type VariantsSecret } from "./languages";
import { checkTestInputShape, parseSignature, returnJType, paramTypes, SignatureError, usesJsonOutput } from "./signature";

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

const PROGRAM_STARTERS: Record<ExtraLang, string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    // Write your solution here
    return 0;
}
`,
  c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    /* Write your solution here */
    return 0;
}
`,
};

/**
 * Build the C++ / C data for a problem: derived declaration, starter and platform wrapper (function mode),
 * or the admin's own driver (custom-driver problems), or a plain starter (full-program mode).
 */
function prepareVariants(d: CodingDraft, signatureText: string, fieldErrors: Record<string, string>, warnings: string[]) {
  const pub: VariantsPublic = {};
  const sec: VariantsSecret = {};
  const c = d.config;
  for (const lang of EXTRA_LANGUAGES) {
    const v = d.languages[lang];
    if (!v) continue;
    const label = LANG_META[lang].label;
    const key = `languages.${lang}`;
    let prefix = "";
    let suffix = "";
    let starter = v.starter_code;
    let declaration = "";
    try {
      if (c.execution_mode === "program") {
        if (!starter.trim()) starter = PROGRAM_STARTERS[lang];
      } else if (v.boilerplate_source.trim()) {
        const bp = parseBoilerplate(v.boilerplate_source, lang);
        prefix = bp.prefix;
        suffix = bp.suffix;
        if (!starter.trim()) starter = bp.starter;
        if (signatureText) {
          // The admin's driver owns main(); we still record the declaration so the method name can be checked.
          try {
            const sig = parseSignature(signatureText);
            declaration = lang === "cpp" ? cppDeclaration(sig) : cDeclaration(sig);
          } catch {
            declaration = "";
          }
        }
      } else if (signatureText) {
        const sig = parseSignature(signatureText);
        const tpl = lang === "cpp" ? buildCppTemplate(sig) : buildCTemplate(sig);
        declaration = tpl.declaration;
        prefix = tpl.prefix;
        suffix = tpl.suffix;
        if (!starter.trim()) starter = c.editable_scope === "body" ? tpl.starterBody : tpl.starterMethod;
      } else {
        throw new BoilerplateError(`This problem has a custom driver, so the ${label} version needs its own boilerplate (full program with STUDENT CODE START/END markers).`);
      }
    } catch (e) {
      if (e instanceof SignatureError || e instanceof BoilerplateError) { fieldErrors[key] = `${label}: ${e.message}`; continue; }
      throw e;
    }
    if (!v.reference_solution.trim()) warnings.push(`${label} has no reference solution, so it cannot be verified against the tests. Add one before publishing.`);
    pub[lang] = { function_signature: declaration, starter_code: starter };
    sec[lang] = { template_prefix: prefix, template_suffix: suffix, boilerplate_source: v.boilerplate_source, reference_solution: v.reference_solution };
  }
  return { pub, sec };
}

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
  let compareMode = c.compare_mode;
  let editableScope = c.editable_scope;

  if (c.execution_mode === "function" && c.function_signature.trim() === "" && d.boilerplate_source.trim() !== "") {
    // Class-design / custom-driver problem (LRU Cache, Min Stack, Trie…): the admin's boilerplate owns main(),
    // reads the operations from stdin and prints the results; the student edits only the marked region.
    try {
      const bp = parseBoilerplate(d.boilerplate_source);
      prefix = bp.prefix;
      suffix = bp.suffix;
      if (!starter.trim()) starter = bp.starter;
      editableScope = "method";
    } catch (e) {
      if (e instanceof BoilerplateError) fieldErrors["boilerplate_source"] = e.message;
      else throw e;
    }
  } else if (c.execution_mode === "function") {
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
      // Structured results (lists of lists, maps, trees…) are compared as values, so "[1, 2]" and "[1,2]" agree.
      const ret = returnJType(sig);
      const outType = ret.k === "void" ? paramTypes(sig)[0].j : ret;
      if (usesJsonOutput(outType) && compareMode === "exact") {
        compareMode = "json";
        warnings.push("This problem's result is structured (JSON), so output comparison was set to \"JSON (structural)\" instead of exact text.");
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

  const variants = prepareVariants(d, signature ?? "", fieldErrors, warnings);

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
      config: { ...c, function_signature: signature ?? "", starter_code: starter, compare_mode: compareMode, editable_scope: editableScope, variants: variants.pub },
      secrets: {
        template_prefix: prefix,
        template_suffix: suffix,
        boilerplate_source: d.boilerplate_source,
        reference_solution: d.reference_solution,
        variants: variants.sec,
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
