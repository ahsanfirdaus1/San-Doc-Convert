import { cp, mkdir } from "node:fs/promises";
await mkdir("public/pdfjs", { recursive: true });
for (const item of ["pdf.worker.min.mjs", "cmaps", "standard_fonts"]) {
  const source = item.endsWith(".mjs")
    ? `node_modules/pdfjs-dist/build/${item}`
    : `node_modules/pdfjs-dist/${item}`;
  await cp(source, `public/pdfjs/${item}`, { recursive: true });
}
