import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@/lib/utils";

// Imported content is untrusted: raw HTML is not rendered at all, and the output is sanitised.
// KaTeX class names / spans produced by math are allowed through the schema.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./, "math-inline", "math-display"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", /^(math|katex)/]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", /^(math|katex)/]],
  },
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-wpt", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeSanitize(schema as never) as never, rehypeKatex as never]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
