import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/lib/store";
import { generateRSS } from "../src/lib/rss";
import { feedResponse } from "../src/lib/feed-response";
import { createFeedGateway } from "../src/lib/tunnel-gateway";
import { diagnosePublicFeed, inspectRSS } from "../src/lib/rss-diagnostic";
import { isPublicUrl, publicOrigin } from "../src/lib/public-url";
import type { Analysis } from "../src/lib/types";
import type { Download } from "../src/lib/network";

const sample: Analysis = {
  id: "public-test-123", url: "https://example.com/news", title: "Journal & articles", description: "Actualités publiques",
  createdAt: "2026-09-26T10:00:00.000Z", method: "rss", confidence: 1, detail: "Test",
  items: [{ title: "Article de test", url: "https://example.com/articles/123", guid: "https://example.com/articles/123", description: "Description", publishedAt: "2026-09-25T12:00:00.000Z" }]
};
const url = "https://rss.example.com/feed/public-test-123";
const download = (xml: string, status = 200, type = "application/rss+xml; charset=utf-8"): Download => ({ url, status, headers: { "content-type": type }, body: Buffer.from(xml) });
test("URL publique : refus localhost, IP privées, URL relatives et HTTP pour le tunnel", () => {
  for (const value of ["http://localhost:3000/feed/x", "http://127.1/a", "https://[::1]/", "https://192.168.1.1/feed/x", "https://10.0.0.1/", "https://169.254.169.254/", "/feed/abc", "https://test.local"]) assert.equal(isPublicUrl(value), false, value);
  assert.equal(publicOrigin("https://a-b.trycloudflare.com/"), "https://a-b.trycloudflare.com");
  for (const value of ["http://example.com", "https://example.com/path", "https://example.com/#fragment"]) assert.throws(() => publicOrigin(value));
});
test("Publication : liens sources publics, GUID stable et permalink correct", () => {
  const xml = generateRSS(sample, url);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/example.com\/articles\/123<\/guid>/);
  assert.equal(generateRSS(sample, url), xml);
  assert.match(xml, /<link>https:\/\/example.com\/news<\/link>/);
  assert.equal(inspectRSS(download(xml), 1).ok, true);
});
test("Les liens privés et relatifs ne sortent jamais dans le XML", () => {
  const malicious: Analysis = { ...sample, items: [...sample.items, ...["http://localhost/post", "http://127.0.0.1/post", "/relative", "http://192.168.0.1/post"].map((link, i) => ({ ...sample.items[0], title: `Piège ${i}`, url: link, guid: link }))] };
  const xml = generateRSS(malicious, url);
  assert.doesNotMatch(xml, /localhost|127\.0\.0\.1|192\.168|relative/);
  assert.equal(inspectRSS(download(xml)).itemCount, 1);
  assert.throws(() => generateRSS({ ...sample, url: "http://localhost/news" }, url));
  assert.throws(() => generateRSS({ ...sample, items: [{ ...sample.items[0], url: "/relative" }] }, url));
});
test("GUID non URL : conservation stable, ancien GUID privé converti en empreinte stable", () => {
  const stable = generateRSS({ ...sample, items: [{ ...sample.items[0], guid: "urn:article:123" }] }, url);
  assert.match(stable, /<guid isPermaLink="false">urn:article:123<\/guid>/);
  const old = { ...sample, items: [{ ...sample.items[0], guid: "http://localhost/old" }] };
  assert.match(generateRSS(old, url), /<guid isPermaLink="false">urn:sha256:[a-f0-9]{64}<\/guid>/);
  assert.equal(generateRSS(old, url), generateRSS(old, url));
});
test("ETag, Last-Modified, HEAD et requêtes conditionnelles conformes", async () => {
  const initial = feedResponse(sample, url, new Request(url));
  const etag = initial.headers.get("etag")!;
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get("content-type"), "application/rss+xml; charset=utf-8");
  assert.equal(initial.headers.get("last-modified"), "Sat, 26 Sep 2026 10:00:00 GMT");
  const cached = feedResponse(sample, url, new Request(url, { headers: { "if-none-match": `W/${etag}` } }));
  assert.equal(cached.status, 304); assert.equal(await cached.text(), "");
  assert.equal(feedResponse(sample, url, new Request(url, { headers: { "if-modified-since": initial.headers.get("last-modified")! } })).status, 304);
  assert.equal(feedResponse(sample, url, new Request(url, { headers: { "if-none-match": '"wrong"', "if-modified-since": "Sun, 27 Sep 2026 10:00:00 GMT" } })).status, 200);
  assert.equal(await feedResponse(sample, url, new Request(url, { method: "HEAD" })).text(), "");
});
test("Diagnostic précis : HTML intermédiaire, XML invalide, RSS absent, channel incomplet", () => {
  assert.ok(inspectRSS(download("<html><body>ngrok warning</body></html>", 200, "text/html")).errors.some(e => e.includes("Content-Type")));
  assert.equal(inspectRSS(download("<rss>")).ok, false);
  assert.equal(inspectRSS(download("<feed/>")).ok, false);
  const report = inspectRSS(download('<rss version="2.0"><channel><description>Test</description></channel></rss>'));
  assert.ok(report.errors.some(e => e.includes("channel.title")));
  assert.ok(report.errors.some(e => e.includes("aucun item")));
});
test("Diagnostic : dates invalides, GUID dupliqués, liens relatifs, HTTP 403", () => {
  const xml = generateRSS(sample, url);
  assert.equal(inspectRSS(download(xml.replace("Fri, 25 Sep 2026 12:00:00 GMT", "not-a-date"))).ok, false);
  assert.equal(inspectRSS(download(xml.replace("Fri, 25 Sep 2026 12:00:00 GMT", "Fri, 30 Feb 2026 12:00:00 GMT"))).ok, false);
  assert.equal(inspectRSS(download(xml.replace("<link>https://example.com/articles/123</link>", "<link>/article/123</link>"))).ok, false);
  assert.equal(inspectRSS(download(generateRSS({ ...sample, items: [sample.items[0], sample.items[0]] }, url))).ok, false);
  assert.equal(inspectRSS(download(xml, 403)).publiclyAccessible, false);
  assert.equal(inspectRSS(download(xml.replace(/<pubDate>.*?<\/pubDate>/, ""))).ok, true);
});
test("Le diagnostic ne contacte jamais une URL localhost", async () => {
  let contacted = false;
  const report = await diagnosePublicFeed("http://localhost:3000/feed/x", 1, { async get() { contacted = true; throw new Error("must not run"); } });
  assert.equal(contacted, false); assert.equal(report.publiclyAccessible, false);
  assert.match(report.errors[0], /localhost/);
});

const store = new Store(":memory:");
const server = createFeedGateway(store, () => "https://rss.example.com", "integration-session");
let origin: string;
before(async () => {
  store.save({ ...sample, createdAt: new Date().toISOString() }); store.publish(sample.id);
  store.save({ ...sample, id: "draft" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
});
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
test("Lecteur distant simulé : GET réel à travers la passerelle, parsing RSS et liens absolus", async () => {
  const response = await fetch(`${origin}/feed/${sample.id}`, { headers: { host: "rss.example.com", "user-agent": "Inoreader-compatible-test" } });
  assert.equal(response.status, 200);
  const xml = await response.text();
  const report = inspectRSS({ url, status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(xml) }, 1);
  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.itemCount, 1);
  assert.match(xml, /https:\/\/rss.example.com\/feed\/public-test-123/);
  const cached = await fetch(`${origin}/feed/${sample.id}`, { headers: { "If-None-Match": response.headers.get("etag")! } });
  assert.equal(cached.status, 304);
});
test("La passerelle n’expose ni administration, ni fichiers, ni brouillons, même avec Host falsifié", async () => {
  for (const path of ["/", "/feeds", "/api/analyze", "/api/tunnel", "/api/feeds", "/api/public/unknown", "/data/rss.sqlite", "/.env.local", "/src/lib/store.ts", "/_next/static/x", "/feed/draft", "/feed/%2e%2e%2fapi%2ftunnel"]) {
    const response = await fetch(origin + path, { headers: { Host: "localhost:3000", "X-Forwarded-Host": "localhost:3000" } });
    assert.equal(response.status, 404, path);
  }
  assert.equal((await fetch(`${origin}/feed/${sample.id}`, { method: "POST" })).status, 405);
  const health = await (await fetch(`${origin}/api/public/health`)).json();
  assert.deepEqual(health, { service: "source-rss-gateway", session: "integration-session" });
});
