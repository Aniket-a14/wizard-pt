"use client";

import { useMemo } from "react";
import { CodeEditor } from "@/components/code-editor";
import { Textarea } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { cDeclaration } from "@/lib/coding/harness-c";
import { cppDeclaration } from "@/lib/coding/harness-cpp";
import { EXTRA_LANGUAGES, LANG_META, type ExtraLang } from "@/lib/coding/languages";
import { parseSignature, type ParsedSignature } from "@/lib/coding/signature";

export interface LangForm {
  referenceSolution: string;
  boilerplateSource: string;
  starterCode: string;
}
export type LanguagesForm = Partial<Record<ExtraLang, LangForm>>;

export const EMPTY_LANG: LangForm = { referenceSolution: "", boilerplateSource: "", starterCode: "" };

/** What the C++ / C declaration of the Java signature looks like (or why the language cannot be offered). */
function derived(lang: ExtraLang, sig: ParsedSignature | null): { ok: true; text: string } | { ok: false; message: string } {
  if (!sig) return { ok: false, message: "Enter a valid Java signature above first (or provide your own boilerplate below)." };
  try {
    return { ok: true, text: lang === "cpp" ? cppDeclaration(sig) : cDeclaration(sig) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function LanguagesPanel({
  value, onChange, signature, mode, errors,
}: {
  value: LanguagesForm;
  onChange: (next: LanguagesForm) => void;
  signature: string;
  mode: "function" | "program";
  errors: Record<string, string>;
}) {
  const sig = useMemo(() => {
    try {
      return signature.trim() ? parseSignature(signature) : null;
    } catch {
      return null;
    }
  }, [signature]);

  return (
    <Panel>
      <PanelHeader title="Languages" />
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted">
          Java is always available. Enable C++ and/or C to let students pick them. Test cases are shared (plain stdin/stdout), and the C++ / C wrapper is generated from the same signature, so the input and output formats are identical.
          Each enabled language needs a reference solution so it can be verified against every test before you rely on it.
        </p>
        {EXTRA_LANGUAGES.map((lang) => {
          const v = value[lang];
          const meta = LANG_META[lang];
          const d = mode === "function" ? derived(lang, sig) : null;
          const blocked = d && !d.ok && !v?.boilerplateSource.trim();
          return (
            <div key={lang} className="rounded-md border border-border">
              <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={!!v}
                  onChange={(e) => {
                    const next = { ...value };
                    if (e.target.checked) next[lang] = { ...EMPTY_LANG }; else delete next[lang];
                    onChange(next);
                  }}
                />
                {meta.label}
              </label>
              {v && (
                <div className="space-y-3 p-3">
                  {d && (d.ok
                    ? <p className="text-xs text-muted">Student signature: <code className="font-mono">{d.text}</code></p>
                    : <p className="text-xs text-warning">{d.message}</p>)}
                  {blocked && <p className="text-xs text-danger">{meta.label} cannot be offered for this signature unless you paste your own boilerplate below.</p>}
                  {errors[`languages.${lang}`] && <p className="text-xs text-danger">{errors[`languages.${lang}`]}</p>}
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted">{meta.label} reference solution (private){mode === "function" ? " — write the function the way a student would" : " — a complete program"}</div>
                    <div className="h-48 overflow-hidden rounded-md border border-border" data-testid={`reference-editor-${lang}`}>
                      <CodeEditor value={v.referenceSolution} language={meta.monaco} onChange={(t) => onChange({ ...value, [lang]: { ...v, referenceSolution: t } })} />
                    </div>
                  </div>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-muted">Advanced: custom starter code / own boilerplate</summary>
                    <div className="mt-2 space-y-2">
                      <div className="text-xs text-muted">Starter code override (leave empty to generate it):</div>
                      <Textarea rows={5} value={v.starterCode} onChange={(e) => onChange({ ...value, [lang]: { ...v, starterCode: e.target.value } })} className="font-mono text-xs" />
                      {mode === "function" && (
                        <>
                          <div className="text-xs text-muted">Full {meta.label} program with the editable region marked by one <code>{"// ==== STUDENT CODE START ===="}</code> and one <code>{"// ==== STUDENT CODE END ===="}</code> line (needed for custom-driver / class-design problems):</div>
                          <Textarea rows={8} value={v.boilerplateSource} onChange={(e) => onChange({ ...value, [lang]: { ...v, boilerplateSource: e.target.value } })} className="font-mono text-xs" />
                        </>
                      )}
                    </div>
                  </details>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
