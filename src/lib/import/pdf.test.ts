import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfText, validatePdfBytes, PdfValidationError } from "./pdf";
import { parseQuestions, type ParsedMcq } from "./text-parser";

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, "../../../tests/fixtures", n)));

describe("PDF import", () => {
  it("extracts text from a text-based PDF and parses its MCQs", async () => {
    const r = await extractPdfText(fx("mcq-text.pdf"));
    expect(r.status).toBe("parsed");
    expect(r.pageCount).toBeGreaterThanOrEqual(1);
    const { questions } = parseQuestions(r.text);
    expect(questions.length).toBe(3);
    const q1 = questions[0] as ParsedMcq;
    expect(q1.kind).toBe("mcq");
    expect(q1.options).toEqual(["Stack", "Queue", "Tree", "Graph"]);
    expect(q1.correct).toEqual([1]);
    expect((questions[2] as ParsedMcq).correct).toEqual([0, 1, 3]);
    expect((questions[2] as ParsedMcq).multi).toBe(true);
  });

  it("reports a scanned / image-only PDF as needs_ocr (never pretends success)", async () => {
    const r = await extractPdfText(fx("scanned-image-only.pdf"));
    expect(r.status).toBe("needs_ocr");
    expect(r.text).toBe("");
    expect(r.message).toMatch(/OCR/);
  });

  it("rejects invalid files before parsing", () => {
    expect(() => validatePdfBytes(fx("fake.pdf"), "fake.pdf")).toThrow(PdfValidationError);
    expect(() => validatePdfBytes(new Uint8Array(0), "x.pdf")).toThrow(/empty/);
    expect(() => validatePdfBytes(fx("mcq-text.pdf"), "notes.txt")).toThrow(/Only .pdf/);
    expect(() => validatePdfBytes(fx("mcq-text.pdf"), "ok.pdf")).not.toThrow();
  });

  it("returns failed for a corrupt PDF body", async () => {
    const bad = new TextEncoder().encode("%PDF-1.4\nthis is garbage\n%%EOF");
    const r = await extractPdfText(bad);
    expect(r.status).toBe("failed");
  });
});
