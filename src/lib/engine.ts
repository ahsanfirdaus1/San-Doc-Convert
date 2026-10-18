import {
  checkOutput,
  readableError,
  signature,
  validateKind,
  validateName,
  validateSelection,
} from "./validation";
import type {
  InputFile,
  Job,
  Options,
  OutputFile,
  Progress,
  ToolId,
  WorkerReply,
} from "./types";

export function runWorker(
  job: Job,
  progress: Progress,
  signal: AbortSignal,
): Promise<OutputFile[]> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(
      new URL("./conversion.worker.ts", import.meta.url),
    );
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (data.type === "progress") progress(data.message, data.progress);
      else if (data.type === "error") {
        cleanup();
        reject(new Error(data.message));
      } else {
        cleanup();
        resolve(data.files);
      }
    };
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          "The processing worker stopped. Try fewer files or reload the page.",
        ),
      );
    };
    worker.postMessage(job);
  });
}
export async function convert(
  tool: ToolId,
  files: File[],
  options: Options,
  progress: Progress,
  signal: AbortSignal,
): Promise<{ outputs: OutputFile[]; archive?: OutputFile }> {
  validateSelection(files, tool);
  const inputs: InputFile[] = [];
  for (const file of files) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = signature(bytes);
    validateKind(tool, kind);
    validateName(file.name, kind);
    inputs.push({ name: file.name, bytes });
  }
  signal.throwIfAborted();
  try {
    let outputs: OutputFile[];
    try {
      outputs =
        tool === "pdf-images"
          ? await (
              await import("./pdf-render")
            ).renderPdf(inputs[0], options, progress, signal)
          : await runWorker({ tool, files: inputs, options }, progress, signal);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "LOCAL_IMAGE_FALLBACK" ||
        !["images-pdf", "image-converter"].includes(tool)
      )
        throw error;
      signal.throwIfAborted();
      const { convertOnPage } = await import("./image-fallback");
      const prepared = await convertOnPage(
        inputs,
        options,
        tool === "images-pdf",
        progress,
        signal,
      );
      outputs =
        tool === "images-pdf"
          ? await runWorker(
              {
                tool: "prepared-images-pdf",
                files: prepared.map((f) => ({ name: f.name, bytes: f.bytes })),
                options,
              },
              progress,
              signal,
            )
          : prepared;
    }
    signal.throwIfAborted();
    checkOutput(outputs.reduce((n, f) => n + f.bytes.length, 0));
    const archive =
      outputs.length > 1
        ? (
            await runWorker(
              {
                tool: "zip",
                files: outputs.map((f) => ({ name: f.name, bytes: f.bytes })),
                options,
              },
              progress,
              signal,
            )
          )[0]
        : undefined;
    signal.throwIfAborted();
    return { outputs, archive };
  } catch (error) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error(readableError(error), { cause: error });
  }
}
