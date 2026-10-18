import { cp, mkdir } from "node:fs/promises";
await mkdir("public/pdfjs", { recursive: true });
for (const item of ["pdf.worker.min.mjs", "cmaps", "standard_fonts"]) {
  const source = item.endsWith(".mjs")
    ? `node_modules/pdfjs-dist/build/${item}`
    : `node_modules/pdfjs-dist/${item}`;
  await cp(source, `public/pdfjs/${item}`, { recursive: true });
}
// Scanned PDFs need PDF.js image decoders too. Keep document evaluators excluded.
await mkdir("public/pdfjs/decoders", { recursive: true });
for (const item of [
  "jbig2_nowasm_fallback.js",
  "openjpeg_nowasm_fallback.js",
  "LICENSE_JBIG2",
  "LICENSE_OPENJPEG",
  "LICENSE_PDFJS_JBIG2",
  "LICENSE_PDFJS_OPENJPEG",
]) {
  await cp(
    `node_modules/pdfjs-dist/wasm/${item}`,
    `public/pdfjs/decoders/${item}`,
  );
}
