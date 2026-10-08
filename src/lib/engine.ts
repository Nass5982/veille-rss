import { randomUUID } from "node:crypto";
import { AppError, asAppError, checkPage } from "./errors";
import { decodeText, SafeFetcher, type Fetcher } from "./network";
import { normalize, canonical } from "./normalize";
import type { Analysis, Extraction, Progress } from "./types";
import { RSSDetector } from "./extractors/RSSDetector";
import { HTMLExtractor } from "./extractors/HTMLExtractor";
import { BrowserExtractor } from "./extractors/BrowserExtractor";
import { APIExtractor } from "./extractors/APIExtractor";
import { manualHTML } from "./extractors/ManualExtractor";
import { settings, type Settings } from "./settings";
import { nextPage } from "./pagination";
export function selectBest(results: Extraction[]): Extraction | undefined {
  return results.filter(r=>r.items.length).sort((a,b)=>{
    if(a.method==="rss")return -1;if(b.method==="rss")return 1;
    const score=(e:Extraction)=>e.confidence*Math.min(e.items.length,30)*(e.method==="api"&&e.confidence>=.9?1.15:1);
    return score(b)-score(a);
  })[0];
}
export interface AnalyzeOptions { network?: Fetcher; browser?: BrowserExtractor; signal?: AbortSignal; settings?: Partial<Settings>; snapshot?: (html:string,url:string)=>void }
export async function analyze(url: string, progress: Progress, options: AnalyzeOptions = {}): Promise<Analysis> {
  const config=settings(options.settings ?? {});
  const network=options.network ?? new SafeFetcher(options.signal,{...config,totalMs:180000});
  const emit=(step:string,status:"running"|"success"|"warning",message:string)=>progress({step,status,message});
  const visited=new Set<string>(); const results: Extraction[]=[]; let current: string|undefined=url;
  let source=url; let count=0;
  while(current && visited.size<(config.pagination?config.maxPages:1)) {
    if(options.signal?.aborted) throw new AppError("CANCELLED","Analyse annulée.");
    if(visited.has(canonical(current)))break;
    visited.add(canonical(current));
    emit("page","running",`GET ${current}`);
    const page=await network.get(current); let html=decodeText(page); checkPage(page.status,html);
    if(visited.size===1)source=page.url;
    if(canonical(page.url)!==canonical(current) && visited.has(canonical(page.url)))break;
    visited.add(canonical(page.url));
    emit("page","success",`HTTP ${page.status} · Page accessible`);
    options.snapshot?.(html,page.url);
    let best: Extraction|undefined;
    if(!config.manual && ["auto","rss"].includes(config.method)) {
      emit("rss","running","Recherche d’un RSS / Atom natif…");
      best=await new RSSDetector().extract(html,page.url,network);
      emit("rss",best?"success":"warning",best?`RSS natif : ${best.items.length} articles`:"Aucun RSS natif exploitable détecté");
      if(!best && config.method==="rss")throw new AppError("RSS_INVALID","Aucun RSS / Atom valide trouvé.");
    }
    if(!best) {
      const server=config.manual?.type==="css"?manualHTML(html,page.url,config.manual,config.timezone):new HTMLExtractor().extract(html,page.url,{maxItems:config.maxArticles,timezone:config.timezone});
      emit("html","success",`${server.detail} · ${server.items.length} articles`);
      const candidates:Extraction[]=[];
      if(config.method!=="api" && config.method!=="browser" && config.manual?.type!=="xpath")candidates.push(server);
      if(config.method==="api" || config.method==="auto") {try {const api=new APIExtractor().extract(JSON.parse(html),page.url,page.url);if(api)candidates.push(api);}catch{/* HTML source */}}
      const sufficient=server.confidence>=.78 && (server.items.length>=3 || server.items.length>=1 && /Schema.org|OpenGraph|manuelle/.test(server.detail));
      const render=config.manual?.type==="xpath" || config.scroll || config.method==="browser" || config.method==="api" && !candidates.length || config.method==="auto" && !sufficient;
      if(render && (config.javascript || config.manual?.type==="xpath")) {
        emit("browser","running","Analyse de la page avec Playwright…");
        try {
          const rendered=await (options.browser ?? new BrowserExtractor()).extract(page.url,network,progress,options.signal,config,(value,renderedUrl)=>{html=value;options.snapshot?.(value,renderedUrl);});
          candidates.push(...rendered.filter(e=>config.method!=="api"||e.method==="api"));
        } catch(error) {
          const failure=asAppError(error);
          if(!server.items.length || config.method!=="auto" || config.manual || ["CLOUDFLARE","CAPTCHA","AUTH","SSRF","CANCELLED"].includes(failure.code))throw failure;
          emit("browser","warning",`${failure.message} Articles HTML conservés.`);
        }
      } else emit("browser","success",config.javascript?"HTML suffisant : navigateur non nécessaire":"JavaScript désactivé");
      best=selectBest(candidates);
    }
    if(!best) {
      if(results.length) {emit("pagination","warning","Page suivante sans article : arrêt de la pagination.");break;}
      throw new AppError(config.manual?"SELECTOR_BROKEN":"EMPTY",config.manual?"La règle ne récupère aucun article valide. Vérifiez le conteneur, le titre et le lien ; la structure du site a peut-être changé.":"Aucun article exploitable trouvé dans le RSS, le HTML, le DOM ou les réponses JSON.");
    }
    results.push(best);
    const total=normalize(results.flatMap(r=>r.items),source,{maxItems:config.maxArticles}).length;
    emit("pagination","success",`${results.length} page(s) analysée(s) · ${total} articles uniques`);
    if(total===count || total>=config.maxArticles || best.method==="rss")break;
    count=total;current=config.pagination?nextPage(html,page.url,visited):undefined;
  }
  const best=selectBest(results)!;
  const items=normalize(results.flatMap(r=>r.items),source,{maxItems:config.maxArticles,timezone:config.timezone});
  emit("normalize","success",`${items.length} articles normalisés et dédoublonnés`);
  emit("selection","success",`Méthode retenue : ${best.method.toUpperCase()} · confiance ${Math.round(best.confidence*100)} %`);
  return {id:randomUUID(),url:source,title:best.title||new URL(source).hostname,description:best.description||`Articles de ${new URL(source).hostname}`,items,method:best.method,confidence:best.confidence,sourceUrl:best.sourceUrl,detail:best.detail,createdAt:new Date().toISOString(),settings:config};
}
