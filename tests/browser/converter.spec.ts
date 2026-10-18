import { test, expect, type Page } from "@playwright/test";
import {
  PDFDocument,
  PDFName,
  PDFString,
  PDFHexString,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  scale,
  translate,
  drawObject,
} from "pdf-lib";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

async function pdfFile(
  name = "confidential-test.pdf",
  widths = [210, 220, 230],
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  widths.forEach((width, index) => {
    const page = pdf.addPage([width, 300]);
    page.drawText(`Page ${index + 1}`, {
      x: 24,
      y: 240,
      font,
      size: 16,
      color: rgb(0.1, 0.2, 0.4),
    });
  });
  return {
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  };
}
function chunk(type: string, data: Buffer) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, sum]);
}
function pngFile(name = "private-image.png") {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0);
  header.writeUInt32BE(3, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((4 * 4 + 1) * 3); // Transparent RGBA image, with one opaque red pixel.
  pixels[5] = 255;
  pixels[8] = 255;
  const buffer = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return { name, mimeType: "image/png", buffer };
}
async function tool(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
}
async function run(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(
    page
      .getByText("Your files are ready.", { exact: true })
      .or(page.locator(".error-message")),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".error-message")).toHaveCount(0);
  await expect(
    page.getByText("Your files are ready.", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}
async function download(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("link", { name: /^(Download file|Download all as ZIP)$/ })
    .click();
  const file = await event;
  const path = await file.path();
  return { bytes: await readFile(path!), name: file.suggestedFilename() };
}
test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("scanned PDF image decoders load locally under CSP", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([210, 300]);
  // CCITT row of eight black pixels: white run 0 followed by black run 8.
  const stream = pdf.context.stream(Uint8Array.of(0x35, 0x14), {
    Type: "XObject",
    Subtype: "Image",
    Width: 8,
    Height: 1,
    BitsPerComponent: 1,
    ColorSpace: "DeviceGray",
    Filter: "CCITTFaxDecode",
    DecodeParms: {
      K: 0,
      Columns: 8,
      Rows: 1,
      EndOfBlock: false,
      EndOfLine: false,
      BlackIs1: false,
    },
  });
  const name = sheet.node.newXObject("Scan", pdf.context.register(stream));
  sheet.pushOperators(
    pushGraphicsState(),
    translate(24, 180),
    scale(160, 80),
    drawObject(name),
    popGraphicsState(),
  );
  const errors: string[] = [];
  page.on("console", (message) => {
    if (/failed|error|violat|refused/i.test(message.text()))
      errors.push(message.text());
  });
  await page.getByLabel("Choose files", { exact: true }).setInputFiles({
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await run(page, "Convert to images");
  const pixel = await page
    .locator(".result-preview img")
    .evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(100, 100, 1, 1).data];
    });
  expect(pixel.slice(0, 3)).toEqual([0, 0, 0]);
  expect(errors).toEqual([]);
});

test("oversized images embedded in PDFs are rejected rather than silently omitted", async ({
  page,
}) => {
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([210, 300]);
  const stream = pdf.context.stream(Uint8Array.of(0), {
    Type: "XObject",
    Subtype: "Image",
    Width: 9000,
    Height: 9000,
    BitsPerComponent: 8,
    ColorSpace: "DeviceGray",
  });
  const name = sheet.node.newXObject("LargeScan", pdf.context.register(stream));
  sheet.pushOperators(
    pushGraphicsState(),
    scale(200, 200),
    drawObject(name),
    popGraphicsState(),
  );
  await page.getByLabel("Choose files", { exact: true }).setInputFiles({
    name: "large-scan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page
    .getByRole("button", { name: "Convert to images", exact: true })
    .click();
  await expect(page.locator(".error-message")).toContainText("16 megapixel");
  await expect(
    page.getByRole("link", { name: "Download file", exact: true }),
  ).toHaveCount(0);
});

test("responsive layout, keyboard navigation, reduced motion, and privacy dialog", async ({
  page,
  isMobile,
}, info) => {
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "on your device.",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (!isMobile) {
    await page.keyboard.press("Tab");
    await expect(page.getByText("Skip to converter")).toBeFocused();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({
    path: info.outputPath("homepage.png"),
    fullPage: true,
  });
  const smallTargets = await page.getByRole("button").evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.width < 44 || rect.height < 44)
        );
      })
      .map((button) => ({
        text: button.textContent,
        label: button.getAttribute("aria-label"),
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      })),
  );
  expect(smallTargets).toEqual([]);
});
test("PDF renders selected pages into a valid image ZIP without external requests or CSP violations", async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) {
      requests.push(request.url());
      expect(request.method()).toBe("GET");
      expect(request.postData()).toBeNull();
    }
  });
  page.on("console", (entry) => {
    if (/content security|violates.*policy|refused to/i.test(entry.text()))
      errors.push(entry.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const active = await pdfFile();
  const activePdf = await PDFDocument.load(active.buffer);
  activePdf.catalog.set(
    PDFName.of("OpenAction"),
    activePdf.context.obj({
      S: PDFName.of("JavaScript"),
      JS: PDFString.of(
        "document.body.dataset.documentScript='executed';fetch('https://example.invalid/document-script')",
      ),
    }),
  );
  active.buffer = Buffer.from(await activePdf.save());
  await page.getByLabel("Choose files", { exact: true }).setInputFiles(active);
  await page.getByLabel("Pages", { exact: true }).fill("1,3");
  await run(page, "Convert to images");
  const result = await download(page);
  const files = unzipSync(result.bytes);
  expect(Object.keys(files)).toHaveLength(2);
  expect(Object.keys(files)[1]).toContain("page-003.png");
  expect([...files[Object.keys(files)[0]].slice(0, 8)]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  await expect(page.locator(".result-preview img")).toBeVisible();
  expect(
    requests.every((url) => new URL(url).origin === new URL(page.url()).origin),
  ).toBe(true);
  expect(requests.some((url) => url.includes("confidential-test"))).toBe(false);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => document.body.dataset.documentScript),
  ).toBeUndefined();
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Download all as ZIP" }),
  ).toHaveCount(0);
  await expect(page.locator(".file-list li")).toHaveCount(0);
});
test("all image conversion directions, transparency, and Images to PDF", async ({
  page,
}) => {
  const supportsWebp = await page.evaluate(() =>
    document
      .createElement("canvas")
      .toDataURL("image/webp")
      .startsWith("data:image/webp"),
  );
  await tool(page, "Image Converter");
  const source = pngFile();
  await page.getByLabel("Choose files", { exact: true }).setInputFiles(source);
  await run(page, "Convert images");
  const jpg = await download(page);
  expect([...jpg.bytes.slice(0, 3)]).toEqual([255, 216, 255]);
  const firstPixel = await page
    .locator(".result-preview img")
    .evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(0, 2, 1, 1).data];
    });
  expect(firstPixel[0]).toBeGreaterThan(240);
  expect(firstPixel[3]).toBe(255);
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByLabel("Choose files", { exact: true }).setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: jpg.bytes,
  });
  await page.getByLabel("Output format").selectOption("webp");
  let webp = {
    bytes: Buffer.from(
      "UklGRkoAAABXRUJQVlA4WAoAAAAQAAAAAwAAAgAAQUxQSAkAAAABBxAREYiI/gcAVlA4IBoAAAAwAQCdASoEAAMAAIAOJaQAA3AA/v9gGAAAAA==",
      "base64",
    ),
    name: "sample.webp",
  };
  if (supportsWebp) {
    await run(page, "Convert images");
    webp = await download(page);
  } else {
    await page
      .getByRole("button", { name: "Convert images", exact: true })
      .click();
    await expect(page.locator(".error-message")).toContainText(
      "cannot export WEBP",
    );
    await expect(
      page.getByRole("link", { name: "Download file", exact: true }),
    ).toHaveCount(0);
  }
  expect(webp.bytes.subarray(8, 12).toString()).toBe("WEBP");
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByLabel("Choose files", { exact: true }).setInputFiles({
    name: "photo.webp",
    mimeType: "image/webp",
    buffer: webp.bytes,
  });
  await page.getByLabel("Output format").selectOption("png");
  await run(page, "Convert images");
  const png = await download(page);
  expect(png.bytes[0]).toBe(137);
  // Cover PNG->WebP, WebP->JPG, and JPG->PNG as well.
  for (const [file, format] of [
    [source, "webp"],
    [{ name: "a.webp", mimeType: "image/webp", buffer: webp.bytes }, "jpeg"],
    [{ name: "a.jpg", mimeType: "image/jpeg", buffer: jpg.bytes }, "png"],
  ] as const) {
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    await page.getByLabel("Choose files", { exact: true }).setInputFiles(file);
    await page.getByLabel("Output format").selectOption(format);
    if (format === "webp" && !supportsWebp) {
      await page
        .getByRole("button", { name: "Convert images", exact: true })
        .click();
      await expect(page.locator(".error-message")).toContainText(
        "cannot export WEBP",
      );
    } else {
      await run(page, "Convert images");
      await download(page);
    }
  }
  await tool(page, "Images to PDF");
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles([
      source,
      { name: "photo.jpg", mimeType: "image/jpeg", buffer: jpg.bytes },
    ]);
  await run(page, "Create PDF");
  const generatedPdf = await PDFDocument.load((await download(page)).bytes);
  expect(generatedPdf.getPageCount()).toBe(2);
  expect(Math.round(generatedPdf.getPage(0).getWidth())).toBe(595);
  await expect(page.locator(".result-preview img")).toBeVisible();
  await page.getByLabel("Page size").selectOption("original");
  await run(page, "Create PDF");
  const fitted = await PDFDocument.load((await download(page)).bytes);
  expect(fitted.getPage(0).getWidth()).toBe(3);
  expect(fitted.getPage(0).getHeight()).toBe(2.25);
});
test("encrypted PDFs and oversized image headers are rejected before conversion", async ({
  page,
}) => {
  const protectedPdf = await PDFDocument.create();
  protectedPdf.addPage();
  protectedPdf.context.trailerInfo.Encrypt = protectedPdf.context.obj({
    Filter: PDFName.of("Standard"),
    V: 1,
    R: 2,
    O: PDFHexString.of("00".repeat(32)),
    U: PDFHexString.of("00".repeat(32)),
    P: -4,
  });
  const encrypted = {
    name: "protected.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await protectedPdf.save({ useObjectStreams: false })),
  };
  await tool(page, "Extract Pages");
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles(encrypted);
  await page
    .getByRole("button", { name: "Extract pages", exact: true })
    .click();
  await expect(page.locator(".error-message")).toContainText(
    "Password-protected",
  );
  await tool(page, "Image Converter");
  const oversized = pngFile();
  oversized.buffer.writeUInt32BE(9000, 16);
  oversized.buffer.writeUInt32BE(9000, 20);
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles(oversized);
  await page
    .getByRole("button", { name: "Convert images", exact: true })
    .click();
  await expect(page.locator(".error-message")).toContainText("megapixel");
});
test("merge ordering, extraction, rotation, remove, and session restoration", async ({
  page,
}) => {
  await tool(page, "Merge PDF");
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles([
      await pdfFile("one.pdf", [210]),
      await pdfFile("two.pdf", [220, 230]),
    ]);
  await page
    .getByRole("button", { name: "Move two.pdf up", exact: true })
    .click();
  await run(page, "Merge PDFs");
  const merged = await PDFDocument.load((await download(page)).bytes);
  expect(merged.getPages().map((p) => p.getWidth())).toEqual([220, 230, 210]);
  await tool(page, "Extract Pages");
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles(await pdfFile());
  await page.getByLabel("Pages", { exact: true }).fill("3,1");
  await run(page, "Extract pages");
  expect(
    (await PDFDocument.load((await download(page)).bytes))
      .getPages()
      .map((p) => p.getWidth()),
  ).toEqual([210, 230]);
  await tool(page, "Rotate PDF");
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles(await pdfFile());
  await page.getByLabel("Pages", { exact: true }).fill("2");
  await run(page, "Rotate pages");
  expect(
    (await PDFDocument.load((await download(page)).bytes))
      .getPages()
      .map((p) => p.getRotation().angle),
  ).toEqual([0, 90, 0]);
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles(await pdfFile());
  await page
    .getByRole("button", { name: "Remove confidential-test.pdf", exact: true })
    .click();
  await expect(page.locator(".file-list li")).toHaveCount(0);
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles(await pdfFile());
  await page.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await expect(page.locator(".file-list li")).toHaveCount(0);
});
test("invalid files and invalid page selections are actionable; cancel is interruptible", async ({
  page,
}) => {
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles({ ...pngFile(), name: "spoofed.pdf" });
  await expect(page.locator(".error-message")).toContainText(
    "Choose PDF files",
  );
  await page.getByLabel("Choose files", { exact: true }).setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nbroken"),
  });
  await page
    .getByRole("button", { name: "Convert to images", exact: true })
    .click();
  await expect(page.locator(".error-message")).toContainText(
    /damaged|read|PDF/i,
  );
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles(await pdfFile());
  await page.getByLabel("Pages", { exact: true }).fill("99");
  await page
    .getByRole("button", { name: "Convert to images", exact: true })
    .click();
  await expect(page.locator(".error-message")).toContainText("between 1 and 3");
  await page.getByLabel("Pages", { exact: true }).fill("");
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles(await pdfFile("large.pdf", Array(100).fill(595)));
  await page
    .getByRole("button", { name: "Convert to images", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel processing", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Cancelled");
  await expect(
    page.getByRole("link", { name: /Download file|Download all/ }),
  ).toHaveCount(0);
  await expect(page.locator(".file-list li")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page
    .getByLabel("Choose files", { exact: true })
    .setInputFiles(await pdfFile());
  await page.getByLabel("Output format").selectOption("jpeg");
  await run(page, "Convert to images");
  const zip = unzipSync((await download(page)).bytes);
  expect(Object.keys(zip)[0]).toMatch(/\.jpg$/);
  expect(zip[Object.keys(zip)[0]][0]).toBe(255);
});
