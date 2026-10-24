import { PageHeader } from "@/components/ui/panel";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import questions" };

export default async function ImportPage({ searchParams }: PageProps<"/admin/import">) {
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Import questions" description="Paste messy text or upload PDFs. You review and fix everything before it becomes a draft question." />
      <ImportWizard initialMode={sp.mode === "pdf" ? "pdf" : "text"} />
    </>
  );
}
