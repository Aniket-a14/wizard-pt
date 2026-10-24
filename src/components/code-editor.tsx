"use client";

import dynamic from "next/dynamic";
import type { OnMount } from "@monaco-editor/react";
import { useEffect, useState } from "react";

const Monaco = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => <div className="flex h-full min-h-24 items-center justify-center text-sm text-muted">Loading editor…</div>,
});

export type EditorTheme = "vs-dark" | "light";

/** Follow the app theme unless the caller pins one (the student workspace defaults to dark). */
export function useAppEditorTheme(): EditorTheme {
  const [t, setT] = useState<EditorTheme>("light");
  useEffect(() => {
    const read = () => setT(document.documentElement.dataset.theme === "dark" ? "vs-dark" : "light");
    read();
    window.addEventListener("wpt-theme", read);
    return () => window.removeEventListener("wpt-theme", read);
  }, []);
  return t;
}

export interface CodeEditorProps {
  value: string;
  onChange?: (v: string) => void;
  language?: string;
  readOnly?: boolean;
  height?: string | number;
  theme?: EditorTheme;
  fontSize?: number;
  onMount?: OnMount;
  ariaLabel?: string;
}

export function CodeEditor({ value, onChange, language = "java", readOnly, height = "100%", theme, fontSize = 13, onMount, ariaLabel }: CodeEditorProps) {
  const appTheme = useAppEditorTheme();
  return (
    <div className="h-full w-full overflow-hidden" style={{ height }} aria-label={ariaLabel ?? "Code editor"}>
      <Monaco
        value={value}
        language={language}
        theme={theme ?? appTheme}
        onChange={(v) => onChange?.(v ?? "")}
        onMount={onMount}
        options={{
          readOnly,
          fontSize,
          tabSize: 4,
          insertSpaces: true,
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          bracketPairColorization: { enabled: true },
          autoClosingBrackets: "always",
          autoIndent: "full",
          formatOnType: true,
          folding: true,
          lineNumbers: "on",
          renderLineHighlight: readOnly ? "none" : "line",
          fontFamily: "var(--font-geist-mono), ui-monospace, Menlo, monospace",
          padding: { top: 8, bottom: 8 },
          accessibilitySupport: "auto",
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}

/** Read-only, syntax-highlighted code viewer sized to its content. */
export function CodeViewer({ code, language = "java", maxHeight = 520 }: { code: string; language?: string; maxHeight?: number }) {
  const lines = code.split("\n").length;
  const h = Math.min(maxHeight, Math.max(120, lines * 19 + 24));
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <CodeEditor value={code} language={language} readOnly height={h} theme="vs-dark" />
    </div>
  );
}
