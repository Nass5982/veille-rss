import { load } from "cheerio";
import { randomUUID } from "node:crypto";
import { analyze } from "./engine";
import { AppError } from "./errors";
import { settings, type Settings, type ManualRule } from "./settings";
import { manualHTML } from "./extractors/ManualExtractor";
import { clean } from "./normalize";
interface Snapshot {html:string;url:string;expires:number}
const shared=globalThis as typeof globalThis & {rssSnapshots?:Map<string,Snapshot>};
const snapshots=shared.rssSnapshots ??=new Map<string,Snapshot>();
export function keepSnapshot(html:string,url:string):string {
  for(const [key,s] of snapshots)if(s.expires<Date.now())snapshots.delete(key);
  while(snapshots.size>=5)snapshots.delete(snapshots.keys().next().value!);
  const id=randomUUID();snapshots.set(id,{html,url,expires:Date.now()+600000});return id;
}
export function snapshot(id:string):Snapshot {const value=snapshots.get(id);if(!value || value.expires<Date.now())throw new AppError("SNAPSHOT_EXPIRED","L’aperçu a expiré. Rechargez la page source.",410);return value;}
export function visualHTML(html:string):string {
  const $=load(html);$("script,style,link,meta,base,iframe,object,embed,svg,math,form,input,button,textarea,select,audio,video,source,noscript").remove();
  $("*").each((_,el)=>{for(const key of Object.keys("attribs" in el ? el.attribs : {}))if(!["class","id","title","alt","datetime","itemprop"].includes(key) && !/^data-[\w-]+$/.test(key))$(el).removeAttr(key);});
  $("img").each((_,el)=>{$(el).attr("alt",$(el).attr("alt") || "[Image]");});
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:15px system-ui;padding:20px;color:#182d2a}article,section{padding:12px;border:1px solid #ddd;margin:8px}*{cursor:crosshair}*:hover{outline:2px solid #198570}img{display:inline-block;min-width:90px;min-height:35px}a{color:#087360}</style></head><body>${$("body").html() ?? ""}</body></html>`;
}
export function testSnapshot(id:string,rule:ManualRule,timezone:string) {
  const saved=snapshot(id);const result=manualHTML(saved.html,saved.url,rule,timezone);const $=load(saved.html);
  try {const containers=$(rule.container);const matches:Record<string,{count:number;values:string[]}>={};for(const [key,f]of Object.entries(rule.fields)){let count=0;const values:string[]=[];containers.slice(0,500).each((_,el)=>{const found=f.selector?$(el).find(f.selector):$(el);count+=found.length;found.slice(0,3).each((_,node)=>{if(values.length<3)values.push(clean(f.mode==="html"?$(node).html():f.mode==="text"?$(node).text():$(node).attr(f.attribute || (key==="image"?"src":"href"))));});});matches[key]={count,values};}return {...result,total:containers.length,matches};}catch(e){throw new AppError("SELECTOR_BROKEN",`Sélecteur invalide : ${String(e)}`);}
}
export async function preview(url:string,config:Settings,signal:AbortSignal) {
  let html="",base=url;const events:import("./types").ProgressEvent[]=[];let analysis;
  try{analysis=await analyze(url,e=>events.push(e),{settings:settings(config),signal,snapshot:(h,u)=>{if(!html || u===base){html=h;base=u;}}});}catch(e){if(!html)throw e;events.push({step:"extraction",status:"error",message:e instanceof Error?e.message:String(e)});}
  const token=keepSnapshot(html,base);return {token,html:visualHTML(html),analysis,events};
}
