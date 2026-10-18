import type { ToolId } from "./types";
export const LIMITS = {
  file: 20 * 1024 ** 2,
  total: 50 * 1024 ** 2,
  files: 10,
  pages: 100,
  pixels: 16_000_000,
  output: 100 * 1024 ** 2,
};
export type FileKind = "pdf" | "png" | "jpeg" | "webp";

export function signature(bytes: Uint8Array): FileKind {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (ascii(0, 5) === "%PDF-") return "pdf";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n))
    return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  throw new Error("This file is not a supported PDF, JPG, PNG, or WebP image.");
}
export function validateName(name: string, kind: FileKind) {
  const extension = name.split(".").pop()?.toLowerCase();
  const allowed = kind === "jpeg" ? ["jpg", "jpeg"] : [kind];
  if (!extension || !allowed.includes(extension))
    throw new Error("The file extension does not match its contents.");
}
export function isImageTool(tool: ToolId) {
  return tool === "images-pdf" || tool === "image-converter";
}
export function validateKind(tool: ToolId, kind: FileKind) {
  if (isImageTool(tool) ? kind === "pdf" : kind !== "pdf")
    throw new Error(
      isImageTool(tool)
        ? "Choose image files for this tool."
        : "Choose PDF files for this tool.",
    );
  if (tool === "images-pdf" && kind === "webp")
    throw new Error(
      "Images to PDF accepts JPG and PNG. Convert your WebP image first.",
    );
}
export function validateSelection(files: { size: number }[], tool: ToolId) {
  if (!files.length) throw new Error("Choose at least one file.");
  if (files.length > LIMITS.files)
    throw new Error("Choose up to 10 files per job.");
  if (["pdf-images", "extract", "rotate"].includes(tool) && files.length !== 1)
    throw new Error("Choose one PDF for this tool.");
  if (files.some((f) => f.size === 0))
    throw new Error("Empty files cannot be processed.");
  if (files.some((f) => f.size > LIMITS.file))
    throw new Error("Each file must be 20 MiB or smaller.");
  if (files.reduce((n, f) => n + f.size, 0) > LIMITS.total)
    throw new Error("Keep the combined file size under 50 MiB.");
}
export function pageIndexes(input: string, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.pages)
    throw new Error("PDFs must contain between 1 and 100 pages per job.");
  if (!input.trim()) return Array.from({ length: count }, (_, i) => i);
  if (input.length > 1000) throw new Error("The page selection is too long.");
  const indexes = new Set<number>();
  for (const part of input.split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error("Use page numbers or ranges, such as 1-3,5.");
    const from = Number(match[1]);
    const to = Number(match[2] || from);
    if (from < 1 || to < from || to > count)
      throw new Error(
        `Choose pages between 1 and ${count}, with ranges in ascending order.`,
      );
    for (let p = from; p <= to; p++) indexes.add(p - 1);
  }
  return [...indexes].sort((a, b) => a - b);
}
export function checkPixels(width: number, height: number) {
  if (
    !(width > 0 && height > 0) ||
    !Number.isFinite(width * height) ||
    width * height > LIMITS.pixels
  )
    throw new Error(
      "This image exceeds the 16 megapixel limit. Try a smaller image or lower PDF resolution.",
    );
}
export function checkOutput(size: number) {
  if (size > LIMITS.output)
    throw new Error(
      "The result exceeds 100 MiB. Choose fewer pages or a lower image quality.",
    );
}
export function safeStem(name: string) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 60) || "document"
  );
}
export function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/encrypt|password/i.test(message))
    return "Password-protected PDFs are not supported. Choose an unencrypted copy.";
  if (/Image exceeded maximum allowed size/i.test(message))
    return "This PDF contains an image above the 16 megapixel limit. Choose a smaller document.";
  if (/invalid pdf|parse|pdf header|xref|unexpected eof/i.test(message))
    return "This PDF could not be read. It may be damaged or incomplete.";
  return message || "The file could not be processed. Try another file.";
}

// Read dimensions before decoding to prevent common oversized image allocations.
export function imageDimensions(
  b: Uint8Array,
  kind: FileKind,
): { width: number; height: number } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0;
  let height = 0;
  if (kind === "png" && b.length >= 24) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  }
  if (kind === "jpeg") {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 255) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2;
        continue;
      }
      const length = view.getUint16(i + 2);
      if (length < 2 || i + 2 + length > b.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      ) {
        height = view.getUint16(i + 5);
        width = view.getUint16(i + 7);
        break;
      }
      i += 2 + length;
    }
  }
  if (kind === "webp" && b.length >= 30) {
    const tag = String.fromCharCode(...b.subarray(12, 16));
    if (tag === "VP8X") {
      width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
      height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    } else if (tag === "VP8 ") {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (tag === "VP8L" && b[20] === 0x2f) {
      const n = view.getUint32(21, true);
      width = (n & 0x3fff) + 1;
      height = ((n >>> 14) & 0x3fff) + 1;
    }
    if (tag === "VP8X" && b[20] & 2)
      throw new Error(
        "Animated WebP files are not supported. Choose a still image.",
      );
  }
  checkPixels(width, height);
  return { width, height };
}
