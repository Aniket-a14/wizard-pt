import { getDocumentProxy, extractText } from "unpdf";
import { stripPageNoise } from "./text-parser";

export const MAX_PDF_BYTES = 15 * 1024 * 1024;

export type PdfStatus = "parsed" | "needs_ocr" | "failed";

export interface PdfExtraction {
  status: PdfStatus;
  pageCount: number;
  text: string;
  /** Characters of text per page, to show why a PDF was judged unreadable. */
  charsPerPage: number[];
  message: string;
}

export class PdfValidationError extends Error {}

/** Cheap checks before touching the parser: size, extension-agnostic magic bytes. */
export function validatePdfBytes(bytes: Uint8Array, fileName: string): void {
  if (bytes.byteLength === 0) throw new PdfValidationError("The file is empty.");
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfValidationError("PDF is larger than 15 MB.");
  if (!/\.pdf$/i.test(fileName)) throw new PdfValidationError("Only .pdf files can be uploaded.");
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
  if (!head.includes("%PDF-")) throw new PdfValidationError("This file is not a valid PDF.");
}

/**
 * Extract the text layer. Image-only (scanned) PDFs are reported honestly as `needs_ocr` —
 * they are never treated as successfully processed.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtraction> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((t) => t ?? "");
    const charsPerPage = pages.map((p) => p.replace(/\s+/g, "").length);
    const total = charsPerPage.reduce((a, b) => a + b, 0);
    if (total < 30 * Math.max(1, totalPages) && total < 120) {
      return {
        status: "needs_ocr",
        pageCount: totalPages,
        text: "",
        charsPerPage,
        message: "This PDF has no readable text layer (it looks scanned or image-only). OCR is required — paste the text manually instead.",
      };
    }
    const joined = stripPageNoise(pages.join("\n\n"));
    return { status: "parsed", pageCount: totalPages, text: joined, charsPerPage, message: `Extracted text from ${totalPages} page${totalPages === 1 ? "" : "s"}.` };
  } catch (e) {
    return {
      status: "failed",
      pageCount: 0,
      text: "",
      charsPerPage: [],
      message: `The PDF could not be read (${(e as Error).message || "corrupt or encrypted file"}).`,
    };
  }
}
