# San Doc Convert

A mobile-first PDF and image toolkit built with Next.js. All document processing runs in the browser. Files and results exist only in application memory until the workspace is cleared, refreshed, or left.

## Tools

| Tool            | Input                                        | Output                                               |
| --------------- | -------------------------------------------- | ---------------------------------------------------- |
| PDF to Images   | One unencrypted PDF; optional page range     | JPG or PNG; multiple pages packaged as ZIP           |
| Images to PDF   | Ordered JPG/PNG files                        | A4 with 24 pt margins, or pages fitted to each image |
| Image Converter | JPG, PNG, still WebP                         | JPG, PNG, WebP                                       |
| Merge PDF       | Two or more ordered PDFs                     | One PDF                                              |
| Extract Pages   | One PDF; optional page range such as `1-3,5` | One PDF in original page order                       |
| Rotate PDF      | One PDF; optional page range                 | One PDF, rotated by 90°, 180°, or 270°               |

PDF export defaults to 144 DPI. Lossy image output defaults to 85% quality. JPG output uses a white background for transparency. Image-to-PDF original size maps image pixels to PDF points at 96 DPI. PDF tools preserve vector content; they do not rasterize whole documents unless exporting images.

## Run locally

Use Node.js 24 LTS and npm. No environment secrets are required.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open `http://localhost:3000`. To inspect the secured production export:

```powershell
npm.cmd run build
npm.cmd start
```

For the same subpath as GitHub Pages:

```powershell
$env:NEXT_PUBLIC_BASE_PATH='/San-Doc-Convert'
npm.cmd run build
npm.cmd start
```

Open `http://127.0.0.1:4173/San-Doc-Convert/`. Without a base path, the production preview is at `http://127.0.0.1:4173/`. The path is set at build time; the preview server must use the same environment value. `npm start` serves the exported `out` directory, rather than running a Next.js backend.

## Validation

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium webkit
npm.cmd run test:e2e
npm.cmd audit
```

Browser tests cover desktop Chromium, 360 px mobile Chromium, and iPhone-sized WebKit. They verify actual PDF contents, image signatures, transparency, ZIP contents, local-only requests, CSP, cancellation, page lifecycle resets, keyboard access, reduced motion, and responsive layout. Emulation does not replace physical Android/iPhone testing.

## Data flow and limits

Files are read through the browser File API. PDF parsing/rendering uses PDF.js and its same-origin worker. PDF transformations, image conversion through OffscreenCanvas, and ZIP assembly run in a separate worker. Browsers without worker image decoding use a sequential page Canvas fallback; PDF assembly and ZIP packaging still use workers. PDF pages render sequentially to a temporary canvas, which is released after each page. Cancelling terminates workers or destroys the PDF task. Previews use canvas-rendered images, never PDF embeds or links inside documents. WebP export depends on the browser encoder; unsupported export is rejected with a clear message rather than saving a PNG under a WebP filename.

Limits: 20 MiB per file, 50 MiB total input, 10 files, 100 combined PDF pages per job, 16 megapixels per image, and 100 MiB of output. ZIP downloads use uncompressed entries to avoid spending CPU recompressing image formats. Compressed-input size limits do not guarantee that every document fits every device's memory; prefer small jobs on phones.

Signatures, extensions, parsed PDF structure, image header dimensions, and decoded image dimensions are checked. Password-protected PDFs and animated WebP files are rejected. Office conversion, OCR, PDF compression, and document editing are outside this version.

No database, upload endpoint, conversion API, analytics, localStorage, IndexedDB, or service worker is used. Static code and conversion assets are downloaded from the same site. GitHub Pages logs website connection information, including IP addresses, independently of document processing. The app does not promise secure erasure from operating-system/browser memory. Files downloaded by the user remain on their device. PDF outputs can preserve document metadata, annotations, and active content; this is not a PDF sanitization tool.

## Security and deployment

`scripts/copy-assets.mjs` copies matching PDF.js worker, CMap, font, and JavaScript image decoder assets from the installed package. The build postprocessor places a CSP directly after the HTML charset declaration and hashes each inline Next.js bootstrap script. Document/script frames, plugins, form submission, external connections, and arbitrary inline scripts are blocked. Inline styling is permitted for framework/rendering compatibility. Meta CSP cannot supply `frame-ancestors` or HTTP-only security headers on GitHub Pages; HTTPS and platform headers are managed by GitHub. Never put secrets or sample personal documents in this public repository.

`.github/workflows/pages.yml` checks types, lint, unit tests, production build, and browser tests before deploying. Pull requests verify without publishing. Pushes to `main` and manual workflow runs publish the `out` artifact using GitHub's Pages actions. Set **Settings → Pages → Source → GitHub Actions** once. Configure the repository as public for GitHub Free. The default site is:

https://ahsanfirdaus1.github.io/San-Doc-Convert/

The workflow derives `NEXT_PUBLIC_BASE_PATH` from the repository name. Do not add `assetPrefix` as a second prefix. All public assets and worker paths use the same base path. To roll back, revert the affected commit and let the same checks redeploy; do not rewrite branch history.

References: [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports), [basePath](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath), [PDF.js](https://mozilla.github.io/pdf.js/), [pdf-lib](https://pdf-lib.js.org/), [GitHub Pages data collection](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection), [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
