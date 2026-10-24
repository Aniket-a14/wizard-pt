/**
 * Languages a coding problem can be solved in. Java is the base language of every problem; C++ and C are
 * optional additions the admin enables per problem. Tests are plain stdin/stdout, so they are shared by
 * all languages.
 */
export const LANGUAGES = ["java", "cpp", "c"] as const;
export type Lang = (typeof LANGUAGES)[number];
export const EXTRA_LANGUAGES = ["cpp", "c"] as const;
export type ExtraLang = (typeof EXTRA_LANGUAGES)[number];

export interface LangMeta {
  label: string;
  /** File name the runner saves the program under (also what compiler messages mention). */
  file: string;
  /** Monaco editor language id. */
  monaco: string;
}

export const LANG_META: Record<Lang, LangMeta> = {
  java: { label: "Java", file: "Main.java", monaco: "java" },
  cpp: { label: "C++", file: "main.cpp", monaco: "cpp" },
  c: { label: "C", file: "main.c", monaco: "c" },
};

export const isLang = (x: unknown): x is Lang => typeof x === "string" && (LANGUAGES as readonly string[]).includes(x);

/** Per-language data stored with a problem version for the optional languages. */
export interface VariantPublic {
  /** The language-specific declaration, e.g. `int countTwinCodes(vector<string>& codes)` (function mode). */
  function_signature: string;
  starter_code: string;
}
export interface VariantSecret {
  template_prefix: string;
  template_suffix: string;
  boilerplate_source: string;
  reference_solution: string;
}
export type VariantsPublic = Partial<Record<ExtraLang, VariantPublic>>;
export type VariantsSecret = Partial<Record<ExtraLang, VariantSecret>>;

/** Name of the method/function in a language-specific declaration (the first identifier before "("). */
export function declaredName(declaration: string): string | null {
  const m = /([A-Za-z_]\w*)\s*\(/.exec(declaration);
  return m ? m[1] : null;
}
