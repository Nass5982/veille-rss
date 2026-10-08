import { createHash } from "node:crypto";
import type { Analysis } from "./types";
import { generateRSS } from "./rss";

/** Shared by Next.js and the isolated tunnel gateway. */
export function feedResponse(feed: Analysis, feedUrl: string, request: Request): Response {
  const xml = generateRSS(feed, feedUrl);
  const etag = `"${createHash("sha256").update(xml).digest("hex")}"`;
  const modified = new Date(feed.createdAt).toUTCString();
  const headers = {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "public, max-age=60, must-revalidate",
    "ETag": etag, "Last-Modified": modified,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox"
  };
  const condition = request.headers.get("if-none-match");
  const unmodified = condition !== null
    ? condition.split(",").some(value => value.trim().replace(/^W\//, "") === etag || value.trim() === "*")
    : !feed.watchReport && !!request.headers.get("if-modified-since") && Date.parse(request.headers.get("if-modified-since")!) >= Date.parse(modified);
  if (unmodified) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : xml, { headers });
}
