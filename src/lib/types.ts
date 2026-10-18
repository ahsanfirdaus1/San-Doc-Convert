export type ToolId =
  | "pdf-images"
  | "images-pdf"
  | "image-converter"
  | "merge"
  | "extract"
  | "rotate";
export type ImageFormat = "png" | "jpeg" | "webp";
export interface Options {
  format: ImageFormat;
  quality: number;
  dpi: number;
  pages: string;
  paper: "a4" | "original";
  rotation: number;
}
export interface InputFile {
  name: string;
  bytes: Uint8Array;
}
export interface OutputFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
  detail: string;
}
export interface Job {
  tool: ToolId | "zip" | "prepared-images-pdf" | "inspect-pdf";
  files: InputFile[];
  options: Options;
}
export type WorkerReply =
  | { type: "progress"; message: string; progress: number }
  | { type: "result"; files: OutputFile[] }
  | { type: "error"; message: string };
export type Progress = (message: string, progress: number) => void;
export const DEFAULT_OPTIONS: Options = {
  format: "png",
  quality: 85,
  dpi: 144,
  pages: "",
  paper: "a4",
  rotation: 90,
};
