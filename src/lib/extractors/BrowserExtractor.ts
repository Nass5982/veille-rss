import { chromium, type Browser } from "playwright";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AppError, asAppError, checkPage } from "../errors";
import { decodeText, LIMITS, type Fetcher } from "../network";
import type { Extraction, Progress } from "../types";
import { HTMLExtractor } from "./HTMLExtractor";
import { APIExtractor } from "./APIExtractor";

import { defaults, type Settings } from "../settings";
import { manualDOM } from "./ManualExtractor";
import { normalize } from "../normalize";

export class BrowserExtractor {
  async extract(url: string, network: Fetcher, progress: Progress, signal?: AbortSignal, config: Settings = defaults, snapshot?: (html: string, url: string) => void): Promise<Extraction[]> {
    let browser: Browser | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const apis: Extraction[] = [];
    let mainError: AppError | undefined;
    let blockedRequests = 0;
    const close = () => { void browser?.close().catch(() => {}); };
    try {
      const configured = process.env.BROWSER_CHANNEL;
      const edgeAvailable = process.platform === "win32" && existsSync(join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"));
      const channel = configured === "msedge" || configured === "chrome" ? configured : !existsSync(chromium.executablePath()) && edgeAvailable ? "msedge" : undefined;
      if (channel) progress({ step: "browser", status: "running", message: `Ouverture de ${channel === "msedge" ? "Microsoft Edge" : "Google Chrome"} via Playwright…` });
      browser = await chromium.launch({ headless: true, timeout: 30_000, channel, args: [
        "--disable-background-networking", "--disable-extensions", "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        // All permitted traffic is fulfilled by SafeFetcher; fail closed for any bypass.
        "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>"
      ] });
      signal?.addEventListener("abort", close, { once: true });
      if (signal?.aborted) throw new AppError("CANCELLED", "Analyse annulée.");
      timer = setTimeout(() => { timedOut = true; close(); }, Math.min(120000, Math.max(LIMITS.browserMs, config.scrollDurationMs + config.timeoutMs)));
      const context = await browser.newContext({ javaScriptEnabled: config.javascript, userAgent: config.userAgent, locale: config.language, timezoneId: config.timezone, serviceWorkers: "block", acceptDownloads: false, permissions: [], viewport: { width: 1280, height: 900 } });
      await context.routeWebSocket("**/*", socket => socket.close());
      await context.route("**/*", async route => {
        const request = route.request();
        try {
          if (["image", "media", "font"].includes(request.resourceType()) || !["GET", "POST"].includes(request.method())) { await route.abort(); return; }
          const post = request.postData() ?? "";
          // Only replay read-only GraphQL POSTs; avoid forms, mutations, analytics writes.
          if (request.method() === "POST") {
            let data: { query?: string };
            try { data = JSON.parse(post) as { query?: string }; } catch { await route.abort(); return; }
            if (typeof data.query !== "string" || /\b(mutation|subscription)\b/i.test(data.query) || !/^\s*(?:query\b|\{)/.test(data.query)) { await route.abort(); return; }
          }
          const result = await network.get(request.url(), request.method() === "POST" ? { method: "POST", body: post, contentType: "application/json" } : {});
          const type = result.headers["content-type"] ?? "text/plain";
          const text = decodeText(result);
          if (request.isNavigationRequest() && request.frame() === context.pages()[0]?.mainFrame()) {
            try { checkPage(result.status, text); } catch (error) { mainError = asAppError(error); await route.abort(); return; }
          }
          if ((["xhr", "fetch"].includes(request.resourceType()) || /json/i.test(type)) && result.status < 400 && apis.length < 30) {
            try {
              const found = new APIExtractor().extract(JSON.parse(text), url, result.url);
              if (found) {
                apis.push(found);
                progress({ step: "api", status: "success", message: `API JSON détectée : ${found.items.length} articles` });
              }
            } catch { /* Not all XHR responses are JSON articles. */ }
          }
          // No remote cookies, authentication challenges, refresh or transport headers.
          const headers: Record<string, string> = { "content-type": type };
          for (const key of ["access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "content-security-policy"]) if (result.headers[key]) headers[key] = result.headers[key];
          await route.fulfill({ status: result.status, headers, body: result.body });
        } catch (error) {
          if (asAppError(error).code === "SSRF") blockedRequests++;
          if (request.isNavigationRequest() && request.frame() === context.pages()[0]?.mainFrame()) mainError = asAppError(error);
          await route.abort().catch(() => {});
        }
      });
      const page = await context.newPage();
      // Prevent secondary pages from becoming uncontrolled crawls.
      context.on("page", newPage => { if (newPage !== page) void newPage.close().catch(() => {}); });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
      progress({ step: "javascript", status: "success", message: "JavaScript exécuté ; observation du DOM et des réponses XHR/fetch" });
      // Wait for actual article signals, then a short network idle window, both bounded.
      await page.waitForFunction(() => document.querySelectorAll("article a[href],h2 a[href],h3 a[href],[itemprop=headline]").length >= 2, { }, { timeout: 6500 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
      if (mainError) throw mainError;
      const collected: Extraction[] = [];
      const read = async () => {
        const size = await page.evaluate(() => document.documentElement.outerHTML.length);
        if(size > LIMITS.domBytes) throw new AppError("DOM_SIZE", "Le DOM dépasse 4 Mo.");
        const html=await page.content();
        if(Buffer.byteLength(html)>LIMITS.domBytes) throw new AppError("DOM_SIZE", "Le DOM dépasse 4 Mo.");
        checkPage(200,html); snapshot?.(html,page.url());
        const result=config.manual ? await manualDOM(page,page.url(),config.manual,config.timezone) : new HTMLExtractor().extract(html,page.url(),{maxItems:config.maxArticles,timezone:config.timezone});
        collected.push(result); return result;
      };
      await read();
      let scrolls=0, clicks=0, stalled=0;
      const deadline=Date.now()+config.scrollDurationMs;
      const count=()=>normalize([...collected,...apis].flatMap(e=>e.items),url,{maxItems:config.maxArticles}).length;
      if(config.scroll) while(Date.now()<deadline && stalled<3 && count()<config.maxArticles && (scrolls<config.maxScrolls || clicks<config.maxClicks)) {
        const before=count(); const signature=await page.evaluate(()=>document.body.innerText.length);
        const more=page.getByRole("button",{name:/^(load more|voir plus|afficher plus|plus d.articles|charger plus)(\s|$)/i}).first();
        if(clicks<config.maxClicks && await more.isVisible().catch(()=>false) && await more.isEnabled().catch(()=>false)) { await more.click({timeout:Math.min(3000,Math.max(1,deadline-Date.now()))}); clicks++; }
        else if(scrolls<config.maxScrolls) { await page.evaluate(()=>window.scrollBy(0,Math.max(window.innerHeight,document.documentElement.scrollHeight))); scrolls++; }
        else break;
        await page.waitForFunction(previous=>document.body.innerText.length!==previous,signature,{timeout:Math.min(1800,Math.max(1,deadline-Date.now()))}).catch(()=>{});
        await page.waitForLoadState("networkidle",{timeout:Math.min(1200,Math.max(1,deadline-Date.now()))}).catch(()=>{});
        await read(); stalled=count()>before ? 0 : stalled+1;
      }
      if(config.scroll) progress({step:"scroll",status:"success",message:`Scroll infini détecté : ${scrolls && count()>collected[0].items.length ? "Oui":"Non confirmé"} · Scrolls réalisés : ${scrolls} · Clics : ${clicks} · Articles : ${count()}`});
      const dom={...collected[0],items:normalize(collected.flatMap(e=>e.items),url,{maxItems:config.maxArticles})};
      if(apis.length>1) apis.unshift({...apis[0],items:normalize(apis.flatMap(e=>e.items),url,{maxItems:config.maxArticles})});
      progress({ step: "dom", status: dom.items.length ? "success" : "warning", message: `DOM rendu analysé : ${dom.items.length} articles${blockedRequests ? ` ; ${blockedRequests} requêtes privées bloquées` : ""}` });
      if (!apis.length) progress({ step: "api", status: "warning", message: "Aucune API JSON d’articles détectée" });
      progress({ step: "browser", status: "success", message: "Analyse du navigateur terminée" });
      return [{ ...dom, method: "browser" }, ...apis];
    } catch (error) {
      if (mainError) throw mainError;
      if (signal?.aborted) throw new AppError("CANCELLED", "Analyse annulée.");
      if (timedOut) throw new AppError("BROWSER_TIMEOUT", "Le navigateur a atteint sa durée maximale configurée.");
      if (/Executable doesn't exist|executable.*not found/i.test(String(error))) throw new AppError("BROWSER_MISSING", "Chromium est indisponible. Exécutez npx playwright install chromium puis relancez l’analyse.");
      throw asAppError(error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", close);
      await browser?.close().catch(() => {});
    }
  }
}
