import { test, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { SafeFetcher, resolvePublic, LIMITS } from "../src/lib/network";
import { AppError } from "../src/lib/errors";

interface MockReply { status?: number; headers?: Record<string, string>; body?: Buffer; hang?: boolean; }
function mockHTTPS(replies: MockReply[], inspect?: (options: RequestOptions) => void) {
  let count = 0;
  mock.method(https, "request", (_url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    inspect?.(options);
    const reply = replies[count++] ?? {};
    const req = new EventEmitter() as ClientRequest;
    req.destroy = ((error?: Error) => { if (error) queueMicrotask(() => req.emit("error", error)); queueMicrotask(() => req.emit("close")); return req; }) as ClientRequest["destroy"];
    req.end = (() => {
      queueMicrotask(() => {
        if (reply.hang) return;
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = reply.status ?? 200; res.headers = reply.headers ?? {};
        callback(res);
        res.emit("data", reply.body ?? Buffer.from("ok")); res.emit("end"); req.emit("close");
      }); return req;
    }) as ClientRequest["end"];
    return req;
  });
  return () => count;
}
test("DNS : un mélange IP publique / privée est refusé", async () => {
  mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  try { await assert.rejects(resolvePublic(new URL("https://example.com")), (e: unknown) => e instanceof AppError && e.code === "SSRF"); }
  finally { mock.restoreAll(); }
});
test("Redirection vers metadata bloquée avant la seconde connexion", async () => {
  const count = mockHTTPS([{ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }]);
  try {
    await assert.rejects(new SafeFetcher().get("https://8.8.8.8"), (e: unknown) => e instanceof AppError && e.code === "SSRF");
    assert.equal(count(), 1);
  } finally { mock.restoreAll(); }
});
test("DNS rebinding : la connexion conserve l’IP publique validée", async () => {
  let resolutions = 0;
  mock.method(dns, "lookup", async () => [{ address: ++resolutions === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }]);
  mockHTTPS([{}], options => {
    assert.ok(options.lookup);
    options.lookup("example.com", { all: true }, (error, address) => { assert.equal(error, null); assert.deepEqual(address, [{ address: "8.8.8.8", family: 4 }]); });
  });
  try { const response = await new SafeFetcher().get("https://example.com"); assert.equal(response.status, 200); assert.equal(resolutions, 1); }
  finally { mock.restoreAll(); }
});
test("Redirections bornées", async () => {
  const count = mockHTTPS(Array.from({ length: 10 }, () => ({ status: 302, headers: { location: "https://8.8.8.8/again" } })));
  try { await assert.rejects(new SafeFetcher().get("https://8.8.8.8"), (e: unknown) => e instanceof AppError && e.code === "REDIRECT"); assert.equal(count(), LIMITS.redirects + 1); }
  finally { mock.restoreAll(); }
});
test("Taille maximale appliquée aux réponses et aux bombes gzip", async () => {
  for (const compressed of [false, true]) {
    const large = Buffer.alloc(LIMITS.bytes + 1, "x");
    mockHTTPS([{ body: compressed ? gzipSync(large) : large, headers: compressed ? { "content-encoding": "gzip" } : {} }]);
    try { await assert.rejects(new SafeFetcher().get("https://8.8.8.8"), (e: unknown) => e instanceof AppError && e.code === "SIZE"); }
    finally { mock.restoreAll(); }
  }
});
test("Timeout absolu, même sans en-tête reçu", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  mockHTTPS([{ hang: true }]);
  try {
    const pending = new SafeFetcher().get("https://8.8.8.8");
    const rejection = assert.rejects(pending, (e: unknown) => e instanceof AppError && e.code === "TIMEOUT");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    mock.timers.tick(LIMITS.requestMs + 1);
    await rejection;
  } finally { mock.restoreAll(); mock.timers.reset(); }
});
