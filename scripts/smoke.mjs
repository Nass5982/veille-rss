import assert from "node:assert/strict";
import { mkdirSync, existsSync } from "node:fs";
import { chromium } from "playwright";
import { XMLValidator, XMLParser } from "fast-xml-parser";

// Optional end-to-end check against a public feed; start npm run dev first.
const source = process.argv[2] ?? "https://feeds.bbci.co.uk/news/rss.xml";
const channel = process.env.BROWSER_CHANNEL ?? (!existsSync(chromium.executablePath()) && process.platform === "win32" ? "msedge" : undefined);
const browser = await chromium.launch({ headless: true, channel });
mkdirSync("test-results", { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.screenshot({ path: "test-results/home.png", fullPage: true });
  await page.getByLabel("Quelle page souhaitez-vous suivre ?").fill("http://127.0.0.1/");
  await page.getByRole("button", { name: "Analyser", exact: true }).click();
  await page.locator(".error").filter({ hasText: "SSRF" }).waitFor();
  console.log("UI: la destination privée est refusée.");
  await page.getByLabel("Quelle page souhaitez-vous suivre ?").fill(source);
  await page.getByRole("button", { name: "Analyser", exact: true }).click();
  await page.locator(".error").waitFor({ state: "hidden" });
  await page.waitForFunction(() => !!document.querySelector('.results') || !!document.querySelector('.error'), { }, { timeout: 75_000 });
  if (await page.locator(".error").count()) throw new Error(await page.locator(".error").innerText());
  const count = await page.locator(".article-card").count();
  assert.ok(count > 0 && count <= 10);
  await page.getByRole("button", { name: "Créer le flux RSS" }).click();
  const input = page.getByLabel("URL locale", { exact: true });
  await input.waitFor();
  const feedUrl = await input.inputValue();
  const response = await context.request.get(feedUrl);
  assert.equal(response.status(), 200);
  assert.match(response.headers()["content-type"], /application\/rss\+xml/);
  const xml = await response.text();
  assert.equal(XMLValidator.validate(xml), true);
  const parsed = new XMLParser().parse(xml);
  assert.ok(parsed.rss.channel.item);
  await page.getByRole("button", { name: "Copier l’URL locale" }).click();
  await page.getByRole("button", { name: "URL locale copiée" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), feedUrl);
  await page.screenshot({ path: "test-results/result-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: "test-results/result-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ source, previewItems: count, feedUrl, xmlValid: true, clipboard: true, mobileOverflow: false, browserErrors: errors }, null, 2));
} finally { await browser.close(); }
