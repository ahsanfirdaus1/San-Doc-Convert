import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import { transformPdf } from "../src/lib/pdf-operations";
import { DEFAULT_OPTIONS } from "../src/lib/types";
import {
  LIMITS,
  signature,
  pageIndexes,
  validateName,
  validateSelection,
  checkPixels,
  checkOutput,
  imageDimensions,
} from "../src/lib/validation";

async function fixture(widths: number[]) {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 300]);
  return { name: "source.pdf", bytes: await pdf.save() };
}
test("page selections are validated, deduplicated, and retain document order", () => {
  assert.deepEqual(pageIndexes("4,1-2,2", 4), [0, 1, 3]);
  assert.deepEqual(pageIndexes("", 2), [0, 1]);
  for (const input of ["0", "2-1", "5", "1,,2", "-1", "1.5", "1e1"])
    assert.throws(() => pageIndexes(input, 4));
  assert.throws(() => pageIndexes("", 101));
});
test("reject mismatched extensions, spoofed files, and limits", () => {
  assert.equal(signature(new TextEncoder().encode("%PDF-1.7")), "pdf");
  assert.throws(() => signature(new TextEncoder().encode("<script>")));
  assert.throws(() => validateName("invoice.jpg", "pdf"));
  assert.throws(() => validateName("invoice.pdf.exe", "pdf"));
  assert.throws(() => validateSelection([{ size: LIMITS.file + 1 }], "merge"));
  assert.throws(() => validateSelection([{ size: 0 }], "merge"));
  assert.throws(() =>
    validateSelection(
      Array.from({ length: 11 }, () => ({ size: 1 })),
      "merge",
    ),
  );
  assert.throws(() =>
    validateSelection(
      [{ size: LIMITS.file }, { size: LIMITS.file }, { size: LIMITS.file }],
      "merge",
    ),
  );
  assert.throws(() => validateSelection([{ size: 1 }, { size: 1 }], "rotate"));
  assert.throws(() => checkPixels(5000, 5000));
  assert.throws(() => checkOutput(LIMITS.output + 1));
});
test("image dimensions are checked before decoding", () => {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 6000);
  view.setUint32(20, 6000);
  assert.throws(() => imageDimensions(bytes, "png"), /megapixel/);
  view.setUint32(16, 100);
  view.setUint32(20, 200);
  assert.deepEqual(imageDimensions(bytes, "png"), { width: 100, height: 200 });
  assert.throws(() => imageDimensions(new Uint8Array(4), "jpeg"));
});
test("merge preserves file and page order", async () => {
  const result = await transformPdf(
    "merge",
    [await fixture([210, 220]), await fixture([230])],
    DEFAULT_OPTIONS,
    () => {},
  );
  const pdf = await PDFDocument.load(result[0].bytes);
  assert.deepEqual(
    pdf.getPages().map((page) => page.getWidth()),
    [210, 220, 230],
  );
});
test("extract produces only requested pages; rotate preserves count and existing rotation", async () => {
  const input = await fixture([210, 220, 230]);
  const extracted = await transformPdf(
    "extract",
    [input],
    { ...DEFAULT_OPTIONS, pages: "1,3" },
    () => {},
  );
  assert.deepEqual(
    (await PDFDocument.load(extracted[0].bytes))
      .getPages()
      .map((page) => page.getWidth()),
    [210, 230],
  );
  const source = await PDFDocument.load(input.bytes);
  source.getPage(0).setRotation(degrees(90));
  const rotated = await transformPdf(
    "rotate",
    [{ name: input.name, bytes: await source.save() }],
    { ...DEFAULT_OPTIONS, pages: "1,3", rotation: 270 },
    () => {},
  );
  assert.deepEqual(
    (await PDFDocument.load(rotated[0].bytes))
      .getPages()
      .map((page) => page.getRotation().angle),
    [0, 0, 270],
  );
});
test("PDF operations reject malformed documents, too many pages, and a one-file merge", async () => {
  await assert.rejects(
    transformPdf("merge", [await fixture([210])], DEFAULT_OPTIONS, () => {}),
    /at least two/,
  );
  await assert.rejects(
    transformPdf(
      "extract",
      [{ name: "broken.pdf", bytes: new TextEncoder().encode("%PDF-broken") }],
      DEFAULT_OPTIONS,
      () => {},
    ),
  );
  await assert.rejects(
    transformPdf(
      "merge",
      [await fixture(Array(60).fill(200)), await fixture(Array(41).fill(200))],
      DEFAULT_OPTIONS,
      () => {},
    ),
    /100 pages/,
  );
});
