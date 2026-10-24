import { EMPTY_MCQ, McqEditor } from "../../mcq-editor";

export const metadata = { title: "New MCQ" };

export default function NewMcq() {
  return <McqEditor initial={EMPTY_MCQ} status="draft" version={1} versionPublished={false} />;
}
