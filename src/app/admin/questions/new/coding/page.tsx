import { CodingEditor, EMPTY_CODING } from "../../coding-editor";

export const metadata = { title: "New coding problem" };

export default function NewCoding() {
  return <CodingEditor initial={EMPTY_CODING} meta={{ status: "draft", version: 1, versionPublished: false, publishedVersion: null, lastValidation: null }} />;
}
