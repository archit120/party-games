import { readFileSync } from "node:fs";
export function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
}
export function sendJSON(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
export async function readBody(req, limit = 4096) {
  if (
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  ) {
    const e = Error("Origin mismatch.");
    e.status = 403;
    throw e;
  }
  let raw = "",
    size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > limit) {
      const e = Error("Request too large.");
      e.status = 413;
      throw e;
    }
    raw += chunk;
  }
  return JSON.parse(raw || "{}");
}
export function serveCoreAsset(path, res) {
  if (path !== "/shared/client.js") return false;
  res.writeHead(200, {
    "Content-Type": "text/javascript",
    "Cache-Control": "no-cache",
  });
  res.end(readFileSync(new URL("./client.js", import.meta.url)));
  return true;
}
