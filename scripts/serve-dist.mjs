// serve-dist.mjs: a tiny in-process static server for the built dist/ tree,
// shared by the headless checks (smoke.mjs, screenshots.mjs). It mirrors the
// build's base path (derived from index.html) so requests resolve like a real
// static host, guards against path traversal, and applies dist/_headers (the
// Cloudflare Pages convention public/_headers is built from, plus whatever
// vite.config.ts's securityHeaders plugin appended) so the checks exercise
// the same response headers a real deploy would send, not a bare file server.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHeadersFile, headersFor } from "../src/lib/securityHeaders.mjs";

export const DIST = fileURLToPath(new URL("../dist", import.meta.url));

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".scad": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ttf": "font/ttf",
  ".conf": "text/plain",
  ".svg": "image/svg+xml",
};

// Derive the base path the bundle was built with (BASE_PATH) from the asset
// URLs in index.html, so the test server matches the build (root or a subpath).
export function detectBase(root = DIST) {
  try {
    const html = readFileSync(join(root, "index.html"), "utf-8");
    const m = html.match(/(?:src|href)="([^"]*\/)assets\//);
    return m ? m[1] : "/";
  } catch {
    return "/";
  }
}

// Read once at server startup, like detectBase(): dist/ doesn't change while
// a single smoke/vis run is in flight. Absent silently (no _headers means an
// unheaded response, same as any host that doesn't honour the file) rather
// than failing the server: a caller building a stripped-down dist/ for a
// narrow test shouldn't need to also fake a _headers file.
function loadHeaderRules(root) {
  try {
    return parseHeadersFile(readFileSync(join(root, "_headers"), "utf-8"));
  } catch {
    return [];
  }
}

// `root` is dist/ for every ordinary check; check-studio.mjs passes the
// throwaway tree its own variant build wrote, which is the only reason this
// takes an argument at all.
export function startServer(root = DIST) {
  const basePath = detectBase(root);
  const headerRules = loadHeaderRules(root);
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.startsWith(basePath)) p = p.slice(basePath.length - 1);
      const rel = normalize(p).replace(/^(\.\.[/\\])+/, "");
      const pathname = rel === "" ? "/" : rel;
      const file = join(root, pathname === "/" ? "index.html" : pathname);
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] || "application/octet-stream",
        ...headersFor(headerRules, pathname),
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
