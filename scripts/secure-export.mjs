import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Next's inline bootstrap needs exact hashes. Do not allow arbitrary inline scripts.
async function secure(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await secure(path);
    else if (entry.name.endsWith(".html")) {
      let html = await readFile(path, "utf8");
      const hashes = [
        ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi),
      ]
        .filter((match) => !/\bsrc\s*=/.test(match[1]))
        .map(
          (match) =>
            `'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`,
        );
      const policy = [
        "default-src 'self'",
        `script-src 'self' ${[...new Set(hashes)].join(" ")}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self' blob: data:",
        "connect-src 'self' blob:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "frame-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ");
      html = html.replace(
        /(<meta\s+charSet="[^"]+"\s*\/?\s*>)/i,
        `$1<meta http-equiv="Content-Security-Policy" content="${policy.replaceAll('"', "&quot;")}"/><meta name="referrer" content="no-referrer"/>`,
      );
      if (!html.includes('http-equiv="Content-Security-Policy"'))
        throw new Error(`CSP injection failed: ${path}`);
      await writeFile(path, html);
    }
  }
}
await secure("out");
await writeFile("out/.nojekyll", "");
