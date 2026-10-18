/// <reference lib="webworker" />
import { PDFDocument, PDFRawStream, PDFName, PDFNumber } from "pdf-lib";
import { zipSync } from "fflate";
import { transformPdf, readPdf } from "./pdf-operations";
import {
  signature,
  validateKind,
  validateName,
  validateSelection,
  imageDimensions,
  checkPixels,
  checkOutput,
  readableError,
  safeStem,
} from "./validation";
import type { Job, OutputFile, Progress, WorkerReply } from "./types";

function reply(message: WorkerReply) {
  self.postMessage(message);
}
const progress: Progress = (message, progress) =>
  reply({ type: "progress", message, progress });
async function bitmap(bytes: Uint8Array) {
  if (
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  )
    throw new Error("LOCAL_IMAGE_FALLBACK");
  const kind = signature(bytes);
  imageDimensions(bytes, kind);
  const image = await createImageBitmap(
    new Blob([new Uint8Array(bytes)], { type: `image/${kind}` }),
  );
  try {
    checkPixels(image.width, image.height);
  } catch (error) {
    image.close();
    throw error;
  }
  return image;
}
function canvasFor(image: ImageBitmap, white: boolean) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("This browser could not create an image canvas.");
  if (white) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, image.width, image.height);
  }
  context.drawImage(image, 0, 0);
  return canvas;
}
async function convert(job: Job): Promise<OutputFile[]> {
  if (job.tool === "inspect-pdf") {
    validateSelection(
      job.files.map((file) => ({ size: file.bytes.length })),
      "pdf-images",
    );
    const pdf = await readPdf(job.files[0].bytes);
    if (!pdf.getPageCount() || pdf.getPageCount() > 100)
      throw new Error("PDFs must contain between 1 and 100 pages per job.");
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (
        !(object instanceof PDFRawStream) ||
        object.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")
      )
        continue;
      const width = object.dict
        .lookup(PDFName.of("Width"), PDFNumber)
        .asNumber();
      const height = object.dict
        .lookup(PDFName.of("Height"), PDFNumber)
        .asNumber();
      checkPixels(width, height);
    }
    return [];
  }
  if (job.tool === "zip") {
    checkOutput(job.files.reduce((n, f) => n + f.bytes.byteLength, 0));
    const entries = Object.fromEntries(job.files.map((f) => [f.name, f.bytes]));
    progress("Preparing ZIP download", 92);
    const bytes = zipSync(entries, { level: 0 });
    checkOutput(bytes.byteLength);
    return [
      {
        name: "san-doc-convert.zip",
        bytes,
        mime: "application/zip",
        detail: `${job.files.length} files`,
      },
    ];
  }
  if (job.tool === "prepared-images-pdf") {
    if (!job.files.length || job.files.length > 10)
      throw new Error("Choose between 1 and 10 images.");
    checkOutput(job.files.reduce((n, f) => n + f.bytes.length, 0));
    const pdf = await PDFDocument.create();
    for (let i = 0; i < job.files.length; i++) {
      const file = job.files[i];
      if (signature(file.bytes) !== "png")
        throw new Error("The prepared image is invalid.");
      const { width: imageWidth, height: imageHeight } = imageDimensions(
        file.bytes,
        "png",
      );
      const embedded = await pdf.embedPng(file.bytes);
      const original = job.options.paper === "original";
      const width = original ? imageWidth * 0.75 : 595.28;
      const height = original ? imageHeight * 0.75 : 841.89;
      const margin = original ? 0 : 24;
      const scale = Math.min(
        (width - margin * 2) / imageWidth,
        (height - margin * 2) / imageHeight,
      );
      pdf.addPage([width, height]).drawImage(embedded, {
        x: (width - imageWidth * scale) / 2,
        y: (height - imageHeight * scale) / 2,
        width: imageWidth * scale,
        height: imageHeight * scale,
      });
      progress(
        `Preparing page ${i + 1} of ${job.files.length}`,
        40 + Math.round(((i + 1) / job.files.length) * 50),
      );
    }
    const bytes = await pdf.save();
    checkOutput(bytes.length);
    return [
      {
        name: "images.pdf",
        bytes,
        mime: "application/pdf",
        detail: `${pdf.getPageCount()} ${pdf.getPageCount() === 1 ? "page" : "pages"}`,
      },
    ];
  }
  validateSelection(
    job.files.map((f) => ({ size: f.bytes.length })),
    job.tool,
  );
  for (const file of job.files) {
    const kind = signature(file.bytes);
    validateKind(job.tool, kind);
    validateName(file.name, kind);
  }
  if (job.tool === "merge" || job.tool === "extract" || job.tool === "rotate")
    return transformPdf(job.tool, job.files, job.options, progress);
  const output: OutputFile[] = [];
  const pdf = job.tool === "images-pdf" ? await PDFDocument.create() : null;
  let totalSize = 0;
  for (let i = 0; i < job.files.length; i++) {
    const file = job.files[i];
    progress(
      `Processing image ${i + 1} of ${job.files.length}`,
      Math.round((i / job.files.length) * 85),
    );
    const image = await bitmap(file.bytes);
    let canvas: OffscreenCanvas | undefined;
    try {
      canvas = canvasFor(
        image,
        job.tool === "image-converter" && job.options.format === "jpeg",
      );
      const mime = pdf ? "image/png" : `image/${job.options.format}`;
      const blob = await canvas.convertToBlob({
        type: mime,
        quality: job.options.quality / 100,
      });
      if (blob.type !== mime)
        throw new Error(
          `This browser cannot export ${job.options.format.toUpperCase()}. Choose another output format.`,
        );
      checkOutput(blob.size);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (pdf) {
        const embedded = await pdf.embedPng(bytes);
        const original = job.options.paper === "original";
        const width = original ? image.width * 0.75 : 595.28;
        const height = original ? image.height * 0.75 : 841.89;
        const margin = original ? 0 : 24;
        const scale = Math.min(
          (width - margin * 2) / image.width,
          (height - margin * 2) / image.height,
        );
        const page = pdf.addPage([width, height]);
        page.drawImage(embedded, {
          x: (width - image.width * scale) / 2,
          y: (height - image.height * scale) / 2,
          width: image.width * scale,
          height: image.height * scale,
        });
        totalSize += bytes.length;
        checkOutput(totalSize);
      } else {
        totalSize += bytes.length;
        checkOutput(totalSize);
        const extension =
          job.options.format === "jpeg" ? "jpg" : job.options.format;
        output.push({
          name: `${String(i + 1).padStart(2, "0")}-${safeStem(file.name)}.${extension}`,
          bytes,
          mime,
          detail: `${image.width} × ${image.height} px`,
        });
      }
    } finally {
      image.close();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }
  if (pdf) {
    progress("Saving PDF", 95);
    const bytes = await pdf.save();
    checkOutput(bytes.length);
    return [
      {
        name: "images.pdf",
        bytes,
        mime: "application/pdf",
        detail: `${pdf.getPageCount()} ${pdf.getPageCount() === 1 ? "page" : "pages"}`,
      },
    ];
  }
  return output;
}
self.onmessage = async ({ data }: MessageEvent<Job>) => {
  try {
    reply({ type: "result", files: await convert(data) });
  } catch (error) {
    reply({ type: "error", message: readableError(error) });
  }
};
