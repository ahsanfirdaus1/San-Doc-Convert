import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("out");
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".bcmap": "application/octet-stream",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (base && pathname !== base && !pathname.startsWith(`${base}/`))
        throw new Error("Not found");
      let file = resolve(root, `.${pathname.slice(base.length) || "/"}`);
      if (file !== root && !file.startsWith(root + sep))
        throw new Error("Not found");
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      res.setHeader(
        "Content-Type",
        types[extname(file)] || "application/octet-stream",
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(await readFile(file));
    } catch (error) {
      console.error(
        `Static preview: ${req.method} ${req.url}: ${error.code || error.message}`,
      );
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(Number(process.env.PORT || 4173), "127.0.0.1", () =>
    console.log(
      `Static site: http://127.0.0.1:${process.env.PORT || 4173}${base}/`,
    ),
  );
