import {
  checkOutput,
  checkPixels,
  imageDimensions,
  safeStem,
  signature,
} from "./validation";
import type { InputFile, Options, OutputFile, Progress } from "./types";

// Some WebKit versions do not expose image decoding in workers. Decode one
// image at a time on the page; PDF assembly and ZIP packaging remain workers.
export async function convertOnPage(
  files: InputFile[],
  options: Options,
  preparingPdf: boolean,
  progress: Progress,
  signal: AbortSignal,
): Promise<OutputFile[]> {
  const output: OutputFile[] = [];
  let total = 0;
  for (let i = 0; i < files.length; i++) {
    signal.throwIfAborted();
    const file = files[i];
    const kind = signature(file.bytes);
    imageDimensions(file.bytes, kind);
    progress(
      `Processing image ${i + 1} of ${files.length}`,
      Math.round((i / files.length) * (preparingPdf ? 40 : 85)),
    );
    const image = new Image();
    const canvas = document.createElement("canvas");
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(file.bytes)], { type: `image/${kind}` }),
    );
    let cancelDecode: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(
            new Error(
              "This image could not be decoded. It may be damaged or unsupported.",
            ),
          );
        cancelDecode = () => {
          image.src = "";
          reject(new DOMException("Cancelled", "AbortError"));
        };
        signal.addEventListener("abort", cancelDecode, { once: true });
        image.src = url;
      });
      signal.throwIfAborted();
      checkPixels(image.naturalWidth, image.naturalHeight);
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("This browser could not create an image canvas.");
      if (!preparingPdf && options.format === "jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0);
      const mime = preparingPdf ? "image/png" : `image/${options.format}`;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("The image could not be created.")),
          mime,
          options.quality / 100,
        ),
      );
      signal.throwIfAborted();
      if (blob.type !== mime)
        throw new Error(
          `This browser cannot export ${options.format.toUpperCase()}. Choose another output format.`,
        );
      total += blob.size;
      checkOutput(total);
      const extension = preparingPdf
        ? "png"
        : options.format === "jpeg"
          ? "jpg"
          : options.format;
      output.push({
        name: `${String(i + 1).padStart(2, "0")}-${safeStem(file.name)}.${extension}`,
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime,
        detail: `${canvas.width} × ${canvas.height} px`,
      });
    } finally {
      if (cancelDecode) signal.removeEventListener("abort", cancelDecode);
      image.onload = null;
      image.onerror = null;
      image.src = "";
      URL.revokeObjectURL(url);
      canvas.width = 0;
      canvas.height = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return output;
}
