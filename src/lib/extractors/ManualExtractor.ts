import { load } from "cheerio";
import type { Page } from "playwright";
import { fields, type ManualRule } from "../settings";
import { normalize } from "../normalize";
import { AppError } from "../errors";
import type { Extraction, RawItem } from "../types";
export function manualHTML(html: string, url: string, rule: ManualRule, timezone = "Europe/Paris"): Extraction {
  if(rule.type !== "css") throw new AppError("SELECTOR", "XPath nécessite le moteur de navigateur.");
  try {
    const $=load(html); const raw: RawItem[]=[];
    $(rule.container).slice(0,500).each((_,card)=>{
      const item: RawItem={};
      for(const key of fields) { const f=rule.fields[key]; if(!f) continue; const el=f.selector ? $(card).find(f.selector).first() : $(card); item[key]= f.mode === "html" ? el.html() : f.mode === "attribute" || f.mode === "url" ? el.attr(f.attribute || (key === "image" ? "src" : "href")) : el.text(); }
      raw.push(item);
    });
    return {method:"html",items:normalize(raw,url,{maxItems:500,timezone}),confidence:1,detail:`Règle manuelle : ${rule.container} · ${raw.length} conteneurs`};
  } catch(error) { throw new AppError("SELECTOR_BROKEN", `Sélecteur CSS invalide : ${error instanceof Error ? error.message : String(error)}`); }
}
export async function manualDOM(page: Page, url: string, rule: ManualRule, timezone: string): Promise<Extraction> {
  try {
    // A string avoids transpiler helper references inside the browser runtime.
    const raw = await page.evaluate(`(() => {
      const rule=${JSON.stringify(rule)}, fields=${JSON.stringify(fields)};
      function select(root, selector) {
        if(!selector)return root instanceof Element?[root]:[];
        if(rule.type==='css')return Array.from(root.querySelectorAll(selector));
        const found=document.evaluate(selector,root,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);
        return Array.from({length:Math.min(found.snapshotLength,500)},(_,i)=>found.snapshotItem(i)).filter(e=>e instanceof Element);
      }
      return select(document,rule.container).slice(0,500).map(card=>{
        const item={};
        for(const key of fields){const f=rule.fields[key];if(!f)continue;const el=select(card,f.selector)[0];item[key]=!el?undefined:f.mode==='html'?el.innerHTML:f.mode==='url'||f.mode==='attribute'?el.getAttribute(f.attribute||(key==='image'?'src':'href')):el.textContent;}return item;
      });
    })()`) as RawItem[];
    return {method:"browser",items:normalize(raw,url,{maxItems:500,timezone}),confidence:1,detail:`Règle manuelle ${rule.type} : ${rule.container}`};
  } catch(error) { throw new AppError("SELECTOR_BROKEN", `Règle ${rule.type} invalide : ${String(error)}`); }
}
