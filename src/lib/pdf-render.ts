import {
  checkPixels,
  checkOutput,
  pageIndexes,
  safeStem,
  LIMITS,
} from "./validation";
import type { InputFile, Options, OutputFile, Progress } from "./types";

let library: Promise<typeof import("pdfjs-dist")> | undefined;
export function loadPdfLibrary() {
  if (!library)
    library = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/pdfjs/pdf.worker.min.mjs`;
      return pdfjs;
    });
  return library;
}
export async function openPdf(bytes: Uint8Array) {
  const pdfjs = await loadPdfLibrary();
  const base = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/pdfjs`;
  return pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWasm: false,
    wasmUrl: `${base}/decoders/`,
    enableXfa: false,
    stopAtErrors: true,
    maxImageSize: LIMITS.pixels,
    canvasMaxAreaInBytes: LIMITS.pixels * 4,
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
  });
}
export async function renderPdf(
  file: InputFile,
  options: Options,
  progress: Progress,
  signal: AbortSignal,
): Promise<OutputFile[]> {
  const task = await openPdf(file.bytes);
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await task.promise;
    const indexes = pageIndexes(options.pages, pdf.numPages);
    const output: OutputFile[] = [];
    let total = 0;
    for (let i = 0; i < indexes.length; i++) {
      signal.throwIfAborted();
      const number = indexes[i] + 1;
      progress(
        `Rendering page ${i + 1} of ${indexes.length}`,
        Math.round((i / indexes.length) * 85),
      );
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: options.dpi / 72 });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      checkPixels(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      try {
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error("This browser could not create an image canvas.");
        await page.render({
          canvasContext: context,
          canvas,
          viewport,
          background: "#ffffff",
        }).promise;
        signal.throwIfAborted();
        const mime = `image/${options.format === "jpeg" ? "jpeg" : "png"}`;
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) =>
              b
                ? resolve(b)
                : reject(new Error("The image could not be created.")),
            mime,
            options.quality / 100,
          ),
        );
        if (blob.type !== mime)
          throw new Error(
            "This image format is not supported by your browser.",
          );
        total += blob.size;
        checkOutput(total);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        output.push({
          name: `${safeStem(file.name)}-page-${String(number).padStart(3, "0")}.${options.format === "jpeg" ? "jpg" : "png"}`,
          bytes,
          mime,
          detail: `Page ${number} · ${width} × ${height} px`,
        });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return output;
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}
export async function pdfThumbnail(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<string> {
  const task = await openPdf(bytes);
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(420 / natural.width, 520 / natural.height, 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    try {
      const context = canvas.getContext("2d");
      if (!context) return "";
      await page.render({
        canvasContext: context,
        canvas,
        viewport,
        background: "#ffffff",
      }).promise;
      signal.throwIfAborted();
      return canvas.toDataURL("image/png");
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}
