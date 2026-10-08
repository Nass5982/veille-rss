import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fixtureServer } from "./fixtures/server";
import { analyze } from "../src/lib/engine";
import { BrowserExtractor } from "../src/lib/extractors/BrowserExtractor";
import type { Download, Fetcher, FetchOptions } from "../src/lib/network";
import type { ProgressEvent } from "../src/lib/types";
import { AppError } from "../src/lib/errors";
import { generateRSS } from "../src/lib/rss";
import { XMLValidator } from "fast-xml-parser";

const server = fixtureServer();
let origin: string;
before(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
// Test-only adapter, never imported by application code. No production SSRF bypass flag.
const fixtureNetwork: Fetcher = {
  async get(url: string, options?: FetchOptions): Promise<Download> {
    const target = new URL(url);
    assert.equal(target.origin, "https://fixture.news", "Fixture must never contact the Internet");
    const response = await fetch(origin + target.pathname + target.search, { method: options?.method, body: options?.body, headers: options?.contentType ? { "content-type": options.contentType } : undefined, redirect: "manual" });
    return { url, status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) };
  }
};
const noBrowser = { async extract(): Promise<never> { throw new Error("Browser should not be launched"); } } as BrowserExtractor;
for (const [path, method] of [["/static", "html"], ["/native", "rss"], ["/malformed", "html"]] as const) test(`Intégration ${path} : extraction réelle HTTP sans navigateur`, async () => {
  const events: ProgressEvent[] = [];
  const result = await analyze(`https://fixture.news${path}`, e => events.push(e), { network: fixtureNetwork, browser: noBrowser });
  assert.equal(result.method, method); assert.equal(result.items.length, 24);
  assert.equal(result.items[0].url, "https://fixture.news/articles/1");
  assert.equal(XMLValidator.validate(generateRSS(result, `http://localhost:3000/feed/${result.id}`)), true);
  assert.ok(!events.some(e => e.step === "browser" && e.status === "running"));
});
for (const [path, method] of [["/js", "browser"], ["/api-page", "api"], ["/graphql-page", "api"]] as const) test(`Playwright ${path} : exécution JS et capture réseau réelles`, { timeout: 40_000 }, async () => {
  const events: ProgressEvent[] = [];
  const result = await analyze(`https://fixture.news${path}`, e => events.push(e), { network: fixtureNetwork });
  assert.equal(result.method, method); assert.equal(result.items.length, 24);
  assert.ok(events.some(e => e.step === "javascript"));
  if (method === "api") { assert.ok(events.some(e => e.step === "api" && e.status === "success")); assert.ok(result.items[0].description); }
});
test("Les pages bloquées produisent un diagnostic spécifique", async () => {
  for (const [path, code] of [["/blocked", "HTTP_403"], ["/captcha", "CAPTCHA"]]) await assert.rejects(analyze(`https://fixture.news${path}`, () => {}, { network: fixtureNetwork }), (e: unknown) => e instanceof AppError && e.code === code);
});
test("Une extraction vide est explicite", { timeout: 40_000 }, async () => {
  await assert.rejects(analyze("https://fixture.news/empty", () => {}, { network: fixtureNetwork }), (e: unknown) => e instanceof AppError && e.code === "EMPTY");
});
