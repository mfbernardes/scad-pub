// serve-dist.mjs — a tiny in-process static server for the built dist/ tree,
// shared by the headless checks (smoke.mjs, screenshots.mjs). It mirrors the
// build's base path (derived from index.html) so requests resolve like a real
// static host, and guards against path traversal.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const DIST = fileURLToPath(new URL("../dist", import.meta.url));

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".scad": "text/plain; charset=utf-8",
  ".ttf": "font/ttf",
  ".conf": "text/plain",
  ".svg": "image/svg+xml",
};

// Derive the base path the bundle was built with (BASE_PATH) from the asset
// URLs in index.html, so the test server matches the build (root or a subpath).
export function detectBase() {
  try {
    const html = readFileSync(join(DIST, "index.html"), "utf-8");
    const m = html.match(/(?:src|href)="([^"]*\/)assets\//);
    return m ? m[1] : "/";
  } catch {
    return "/";
  }
}

export function startServer() {
  const basePath = detectBase();
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.startsWith(basePath)) p = p.slice(basePath.length - 1);
      const rel = normalize(p).replace(/^(\.\.[/\\])+/, "");
      const file = join(DIST, rel === "/" || rel === "" ? "index.html" : rel);
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] || "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port, basePath })
    )
  );
}
