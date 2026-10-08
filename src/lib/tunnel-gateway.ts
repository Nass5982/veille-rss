import { createServer } from "node:http";
import { feedResponse } from "./feed-response";
import { asAppError } from "./errors";
import type { Store } from "./store";

/** This server has no proxy, file serving, admin routes or directory listing. */
export function createFeedGateway(store: Pick<Store, "get"> & Partial<Pick<Store,"output">>, publicBase: () => string | undefined, session: string) {
  const server = createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end("Lecture seule."); return; }
    const path = (req.url ?? "").split("?")[0];
    if (path === "/api/public/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ service: "source-rss-gateway", session })); return;
    }
    const match = /^\/feed\/([a-zA-Z0-9-]{1,100})$/.exec(path);
    if (!match) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Route non exposée."); return; }
    void (async () => {
      const base = publicBase();
      if (!base) { res.writeHead(503); res.end("L’URL publique n’est pas encore disponible."); return; }
      const feed = store.output ? store.output(match[1]) : store.get(match[1], true);
      if (!feed) { res.writeHead(404); res.end("Flux publié introuvable."); return; }
      // The public base is discovered/configured locally, never taken from Host or forwarded headers.
      const url = `${base}/feed/${match[1]}`;
      const conditional = new Headers();
      for (const key of ["if-none-match", "if-modified-since"]) { const value = req.headers[key]; if (typeof value === "string") conditional.set(key, value); }
      const response = feedResponse(feed, url, new Request(url, { method: req.method, headers: conditional }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === "HEAD" ? undefined : await response.text());
    })().catch(error => {
      const failure = asAppError(error);
      if (!res.headersSent) res.writeHead(failure.status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(failure.message);
    });
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 3000;
  server.maxHeadersCount = 30;
  return server;
}
