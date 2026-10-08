import { test } from "node:test";
import assert from "node:assert/strict";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { absolute, clean, dateISO, normalize } from "../src/lib/normalize";
import { publicAddress, parseRemoteUrl, SafeFetcher } from "../src/lib/network";
import { HTMLExtractor } from "../src/lib/extractors/HTMLExtractor";
import { RSSDetector } from "../src/lib/extractors/RSSDetector";
import { APIExtractor } from "../src/lib/extractors/APIExtractor";
import { selectBest } from "../src/lib/engine";
import { checkPage, asAppError, AppError } from "../src/lib/errors";
import { generateRSS } from "../src/lib/rss";
import { Store } from "../src/lib/store";
import { localRequest } from "../src/lib/http";
import type { Analysis } from "../src/lib/types";

test("SSRF : IPv4/IPv6 privées, réservées, encodages alternatifs, ports et protocoles", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.1.2", "192.168.0.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.1.1.1", "192.0.0.1", "198.18.0.1", "::", "::1", "fc00::1", "fe80::1", "2001:db8::1", "::ffff:127.0.0.1", "2002:7f00:1::", "64:ff9b::7f00:1"]) assert.equal(publicAddress(address), false, address);
  for (const url of ["http://localhost", "http://localhost.", "http://127.1", "http://2130706433", "http://0x7f000001", "http://[::1]", "http://[::ffff:127.0.0.1]", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "ftp://example.com", "https://user:pass@example.com", "http://example.com:8080", "http://service.internal"]) assert.throws(() => parseRemoteUrl(url), AppError, url);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  assert.equal(parseRemoteUrl("https://example.com/path#hash").href, "https://example.com/path");
});
test("Transport de production : refus réel avant accès au réseau local", async () => {
  await assert.rejects(new SafeFetcher().get("http://127.0.0.1"), (e: unknown) => e instanceof AppError && e.code === "SSRF");
});
test("Normalisation et dédoublonnage multi-clés, contenu dangereux nettoyé", () => {
  const items = normalize([
    { title: "<b>Premier &amp; article</b>", url: "/one?utm_source=test", description: '<script>alert(1)</script><p>Texte <img src=x onerror=alert(1)>propre</p>', publishedAt: "2026-09-20" },
    { title: "Premier & article", url: "/one", publishedAt: "2026-09-20" },
    { title: "Deuxième article", url: "/two", guid: "stable" },
    { title: "Autre URL", url: "/two-mirror", guid: "stable" },
    { title: "Mauvais lien", url: "javascript:alert(1)" },
    { title: "Troisième article", url: "/three", publishedAt: "nonsense" }
  ], "https://example.com/blog/");
  assert.equal(items.length, 3); assert.equal(items[0].description, "Texte propre"); assert.equal(items[0].url, "https://example.com/one"); assert.equal(items[2].publishedAt, undefined);
  assert.equal(absolute("data:text/html,x", "https://example.com"), undefined);
  assert.equal(clean("<svg><script>evil</script></svg>texte"), "texte");
  assert.equal(dateISO(1700000000), "2023-11-14T22:13:20.000Z");
});
test("RSS, Atom, dates absentes et XML malformé", () => {
  const detector = new RSSDetector();
  const atom = detector.parse('<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><title>Un article</title><link href="/one"/><id>urn:test:1</id><author><name>Camille</name></author><summary>Texte</summary></entry></feed>', "https://example.com/atom");
  assert.equal(atom?.items[0].author, "Camille"); assert.equal(atom?.items[0].url, "https://example.com/one");
  const escaped = detector.parse('<rss version="2.0"><channel><title>A &amp; B</title><item><title>Article &amp; exemple</title><link>https://example.com/a?section=world&amp;page=2</link></item></channel></rss>', "https://example.com/rss");
  assert.equal(escaped?.items[0].url, "https://example.com/a?page=2&section=world");
  assert.equal(escaped?.title, "A & B");
  assert.equal(detector.parse('<rss><channel><item>', "https://example.com"), undefined);
  assert.equal(detector.parse('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss/>', "https://example.com"), undefined);
});
test("JSON-LD, OpenGraph et cartes répétées reçoivent un score", () => {
  const extractor = new HTMLExtractor();
  const ld = extractor.extract('<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","headline":"Article structuré","url":"/news","datePublished":"2026-01-01","author":{"name":"Alice"}}]}</script>', "https://example.com");
  assert.equal(ld.items.length, 1); assert.equal(ld.items[0].author, "Alice"); assert.ok(ld.confidence > 0.9);
  const og = extractor.extract('<meta property="og:type" content="article"><meta property="og:title" content="Article OpenGraph"><meta property="og:url" content="/canonical">', "https://example.com");
  assert.equal(og.items[0].url, "https://example.com/canonical");
  const cards = extractor.extract('<section>' + [1, 2, 3].map(i => `<div class="card"><h2><a href="/a${i}">Article ${i}</a></h2><p>Description ${i}</p></div>`).join("") + '</section>', "https://example.com");
  assert.equal(cards.items.length, 3); assert.ok(cards.confidence >= 0.8);
  const header = extractor.extract('<article><header><h2><a href="/nested">Titre dans un en-tête d’article</a></h2></header><p>Description</p></article>', "https://example.com");
  assert.equal(header.items[0].title, "Titre dans un en-tête d’article");
});
test("API : REST, GraphQL et rejet de listes sans URL", () => {
  const api = new APIExtractor();
  const entries = [1, 2, 3].map(i => ({ node: { title: { rendered: `Article ${i}` }, link: `/article/${i}`, date: "2026-01-01", excerpt: { rendered: "<p>Texte</p>" } } }));
  const result = api.extract({ data: { posts: { edges: entries } } }, "https://example.com", "https://example.com/graphql");
  assert.equal(result?.items.length, 3); assert.ok(result!.confidence >= .9);
  assert.equal(api.extract([{ name: "Alice" }, { name: "Bob" }], "https://example.com", "https://example.com/api"), undefined);
  assert.equal(selectBest([result!, { ...result!, method: "browser", confidence: .85 }])?.method, "api");
});
test("Diagnostics détaillés, protection de l’API locale", () => {
  for (const [status, html, code] of [[403, "Forbidden", "HTTP_403"], [429, "", "HTTP_429"], [200, "cf-chl-test", "CLOUDFLARE"], [200, '<div class="h-captcha">verify</div>', "CAPTCHA"], [401, "", "AUTH"]] as const) assert.throws(() => checkPage(status, html), (e: unknown) => e instanceof AppError && e.code === code);
  assert.equal(asAppError({ code: "ENOTFOUND" }).code, "DNS");
  assert.equal(asAppError({ code: "CERT_HAS_EXPIRED" }).code, "SSL");
  assert.throws(() => localRequest(new Request("http://localhost:3000/api/analyze", { headers: { host: "evil.example", origin: "https://evil.example" } }), true));
  assert.throws(() => localRequest(new Request("http://localhost:3000/api/analyze", { headers: { host: "localhost:3000", origin: "https://evil.example" } }), true));
});
test("SQLite persiste la publication ; RSS valide et contenu échappé", () => {
  const store = new Store(":memory:");
  const feed: Analysis = { id: "test", url: "https://example.com", title: "A & B", description: "<journal>", items: normalize([{ title: "Titre & texte", url: "/one", author: "Alice", description: "<b>Texte</b>", publishedAt: "2026-09-24", image: "/photo.jpg" }], "https://example.com"), method: "html", confidence: .9, detail: "Test", createdAt: new Date().toISOString() };
  store.save(feed); assert.equal(store.get(feed.id, true), undefined); assert.equal(store.publish(feed.id), true); assert.deepEqual(store.get(feed.id, true), JSON.parse(JSON.stringify(feed)));
  const xml = generateRSS(feed, "http://localhost:3000/feed/test");
  assert.equal(XMLValidator.validate(xml), true);
  const parsed = new XMLParser().parse(xml);
  assert.equal(parsed.rss.channel.title, "A & B"); assert.equal(parsed.rss.channel.item["dc:creator"], "Alice");
  assert.match(xml, /Thu, 24 Sep 2026 00:00:00 GMT/); assert.ok(!xml.includes("Invalid Date")); store.close();
});
