import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const db = new DatabaseSync("data/rss.sqlite", { readOnly: true });
const row = db.prepare("SELECT id FROM analyses WHERE published = 1 ORDER BY created_at DESC LIMIT 1").get();
db.close();
if (!row) throw new Error("Publiez un flux avant ce test et démarrez npm run dev.");
const channel = process.env.BROWSER_CHANNEL ?? (!existsSync(chromium.executablePath()) && process.platform === "win32" ? "msedge" : undefined);
const browser = await chromium.launch({ headless: true, channel });
const base = "http://localhost:3000";
mkdirSync("test-results", { recursive: true });
let started = false;
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`${base}/feeds/${row.id}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.body.innerText.includes("Lecture de l’état du tunnel…"));
  await page.getByRole("button", { name: "Activer l’accès externe", exact: true }).waitFor();
  assert.match(await page.getByLabel("URL locale", { exact: true }).inputValue(), /^http:\/\/localhost:3000\/feed\//);
  const existingPublicUrl = await page.getByLabel("URL publique", { exact: true }).inputValue();
  if (!existingPublicUrl) assert.equal(await page.getByRole("button", { name: "Copier l’URL publique" }).isDisabled(), true);
  await page.getByRole("button", { name: "Copier l’URL locale" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${base}/feed/${row.id}`);
  if (!existingPublicUrl) await page.getByRole("button", { name: "Activer l’accès externe", exact: true }).click();
  started = true;
  console.log(existingPublicUrl ? "Vérification du tunnel déjà démarré depuis l’interface." : "Démarrage demandé depuis l’interface locale.");
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="URL publique"]');
    return input?.value?.startsWith("https://");
  }, {}, { timeout: 65_000 });
  await page.waitForFunction(() => document.body.innerText.includes("Accès externe : Actif") || document.body.innerText.includes("TCP sortant 7844"), {}, { timeout: 40_000 });
  const publicUrl = await page.getByLabel("URL publique", { exact: true }).inputValue();
  const active = (await page.locator(".access-badge").innerText()).includes("Actif");
  assert.equal(await page.getByRole("button", { name: "Copier l’URL publique" }).isDisabled(), !active);
  await page.getByRole("button", { name: "Tester la compatibilité RSS", exact: true }).click();
  await page.locator(".diagnostic").waitFor({ timeout: 30_000 });
  const diagnostic = await page.locator(".diagnostic").innerText();
  if (active) {
    assert.match(diagnostic, /200 OK/);
    await page.getByRole("button", { name: "Copier l’URL publique" }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), publicUrl);
  } else { assert.match(diagnostic, /Non/); assert.match(diagnostic, /530|accès|échoué|expired|TLS|SSL/i); }
  await page.screenshot({ path: "test-results/tunnel-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "test-results/tunnel-mobile.png", fullPage: true });
  await page.getByRole("button", { name: active ? "Désactiver l’accès externe" : "Arrêter le tunnel en échec", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="URL publique"]')?.value === "", {}, { timeout: 20_000 });
  const health = await fetch("http://127.0.0.1:4318/api/public/health").then(() => true).catch(() => false);
  assert.equal(health, false, "La passerelle doit fermer à l’arrêt du tunnel");
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ localUrl: `${base}/feed/${row.id}`, publicUrl, publiclyAccessible: active, stopped: true, mobileOverflow: false, browserErrors: pageErrors }, null, 2));
} finally {
  if (started) await fetch(`${base}/api/tunnel`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: '{"action":"stop"}' }).catch(() => {});
  await browser.close();
}
