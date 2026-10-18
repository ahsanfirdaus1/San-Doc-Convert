import { PDFDocument, degrees } from "pdf-lib";
import { LIMITS, pageIndexes, checkOutput, safeStem } from "./validation";
import type { InputFile, Options, OutputFile, Progress, ToolId } from "./types";

export async function readPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    pdf.getPageCount();
    return pdf;
  } catch (cause) {
    const protectedFile =
      cause instanceof Error && /encrypt|password/i.test(cause.message);
    throw new Error(
      protectedFile
        ? "Password-protected PDFs are not supported. Choose an unencrypted copy."
        : "This PDF could not be read. It may be damaged or incomplete.",
      { cause },
    );
  }
}

export async function transformPdf(
  tool: ToolId,
  files: InputFile[],
  options: Options,
  progress: Progress,
): Promise<OutputFile[]> {
  if (tool === "merge" && files.length < 2)
    throw new Error("Choose at least two PDFs to merge.");
  const documents: PDFDocument[] = [];
  let total = 0;
  for (let i = 0; i < files.length; i++) {
    progress(
      `Reading PDF ${i + 1} of ${files.length}`,
      Math.round((i / files.length) * 35),
    );
    const pdf = await readPdf(files[i].bytes);
    total += pdf.getPageCount();
    if (!pdf.getPageCount() || total > LIMITS.pages)
      throw new Error("Choose PDFs with a combined total of 1 to 100 pages.");
    documents.push(pdf);
  }
  let output: PDFDocument;
  if (tool === "rotate") {
    output = documents[0];
    for (const i of pageIndexes(options.pages, total)) {
      const page = output.getPage(i);
      page.setRotation(
        degrees(
          (((page.getRotation().angle + options.rotation) % 360) + 360) % 360,
        ),
      );
    }
  } else {
    output = await PDFDocument.create();
    for (let i = 0; i < documents.length; i++) {
      const source = documents[i];
      const indexes =
        tool === "extract"
          ? pageIndexes(options.pages, source.getPageCount())
          : source.getPageIndices();
      for (const page of await output.copyPages(source, indexes))
        output.addPage(page);
      progress(
        `Preparing PDF ${i + 1} of ${documents.length}`,
        40 + Math.round(((i + 1) / documents.length) * 40),
      );
    }
  }
  progress("Saving PDF", 90);
  const bytes = await output.save();
  checkOutput(bytes.byteLength);
  const label =
    tool === "merge" ? "merged" : tool === "extract" ? "extracted" : "rotated";
  return [
    {
      bytes,
      name:
        tool === "merge"
          ? "merged.pdf"
          : `${safeStem(files[0].name)}-${label}.pdf`,
      mime: "application/pdf",
      detail: `${output.getPageCount()} ${output.getPageCount() === 1 ? "page" : "pages"}`,
    },
  ];
}
