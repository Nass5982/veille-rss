import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { FeedItem,Analysis } from "./types";
import type { Filter,WatchConfig,Transformation } from "./watch-types";
import { AppError } from "./errors";
import { canonical,clean } from "./normalize";
import { safeHTML } from "./sanitize-html";
import type { Store } from "./store";
export interface WatchItem extends FeedItem {sourceId?:string;sourceName?:string;sourceUrl?:string;detectedAt?:string;content?:string;descriptionHtml?:string}
/** Regex operates over a bounded batch with a VM CPU deadline: pathological patterns cannot block the server. */
function regexBatch(values:string[],pattern:string,flags:string,replacement?:string):(boolean|string)[] {
 try {return runInNewContext(replacement===undefined?'const r=new RegExp(pattern,flags);values.map(v=>{r.lastIndex=0;return r.test(v)})':'const r=new RegExp(pattern,flags);values.map(v=>v.replace(r,replacement))',{values:values.map(v=>v.slice(0,20000)),pattern,flags,replacement},{timeout:75,contextCodeGeneration:{strings:false,wasm:false}}) as (boolean|string)[];}
 catch {throw new AppError("REGEX_LIMIT","Regex invalide ou trop coûteuse. Simplifiez le motif (durée maximale : 75 ms par lot).");}
}
function field(item:WatchItem,key:string):string {switch(key){case "titleOrDescription":return item.title+"\n"+item.description;case "site":return item.sourceUrl?new URL(item.sourceUrl).hostname:new URL(item.url).hostname;case "source":return item.sourceName??"";case "date":return item.publishedAt??"";case "content":return item.content??item.description;default:return String(item[key as keyof WatchItem]??"");}}
export function matchFilter(items:WatchItem[],filter:Filter,now=Date.now()):boolean[] {
 if(filter.type==="group") {if(!filter.children.length)return items.map(()=>true);const groups=filter.children.map(c=>matchFilter(items,c,now));return items.map((_,i)=>filter.operator==="or"?groups.some(g=>g[i]):filter.operator==="not"?!groups.some(g=>g[i]):groups.every(g=>g[i]));}
 const values=items.map(i=>field(i,filter.field));if(filter.operator==="regex")return regexBatch(values,filter.value,filter.caseSensitive?"":"i") as boolean[];
 return values.map(value=>{const left=filter.caseSensitive?value:value.toLocaleLowerCase();const right=filter.caseSensitive?filter.value:filter.value.toLocaleLowerCase();switch(filter.operator){case "contains":return left.includes(right);case "notContains":return !left.includes(right);case "startsWith":return left.startsWith(right);case "endsWith":return left.endsWith(right);case "equals":return left===right;case "notEquals":return left!==right;case "after":return Date.parse(value)>Date.parse(filter.value);case "before":return Date.parse(value)<Date.parse(filter.value);case "lastDays":{const date=Date.parse(value);return date<=now && date>=now-Number(filter.value)*86400000;}default:return false;}});
}
export function transform(items:WatchItem[],rules:Transformation[]):WatchItem[] {
 let result=items.map(i=>({...i}));
 for(const rule of rules){const values=result.map(i=>rule.operation==="safeHtml"?(i.descriptionHtml??i.description):i[rule.field]);
 let changed:string[];
 if(rule.regex&&["replace","remove"].includes(rule.operation))changed=regexBatch(values,rule.value,rule.caseSensitive?"g":"gi",rule.operation==="remove"?"":rule.replacement) as string[];
 else changed=values.map((value,index)=>{switch(rule.operation){case "template":return rule.value.replace(/\{(titre|title|source|description)\}/g,(_,key:string)=>key==="source"?result[index].sourceName??"":key==="description"?result[index].description:result[index].title);case "replace":case "remove":{if(!rule.value)return value;const escaped=rule.value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");return value.replace(new RegExp(escaped,rule.caseSensitive?"g":"gi"),()=>rule.operation==="remove"?"":rule.replacement);}case "plain":return clean(value,20000);case "safeHtml":return safeHTML(value);case "trim":return value.replace(/\s+/g," ").trim();case "truncate":return value.slice(0,+rule.value);default:return value;}});
 result=result.map((item,index)=>{let value=changed[index].slice(0,20000);if(rule.field==="title")value=clean(value,500)||item.title;else if(rule.operation!=="plain")value=safeHTML(value);return {...item,[rule.field]:value,descriptionHtml:rule.field==="description"?value:item.descriptionHtml};});
 }
 return result;
}
export function normalizedTitle(title:string):string {return clean(title).normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();}
export function similarity(a:string,b:string):number {const x=normalizedTitle(a),y=normalizedTitle(b);if(x===y)return 1;const stop=new Set(["le","la","les","de","du","des","a","en","et","un","une","the","of","to","dans"]);const tokens=(s:string)=>new Set(s.split(" ").filter(w=>!stop.has(w)));const left=tokens(x),right=tokens(y);if(!left.size||!right.size)return 0;const common=[...left].filter(w=>right.has(w)).length;return 2*common/(left.size+right.size);}
export function deduplicate(items:WatchItem[],config:WatchConfig["dedup"]):{items:WatchItem[];duplicates:{kept:string;removed:string;score:number}[]} {
 if(config.keep==="both")return {items,duplicates:[]};
 const rank=(id?:string)=>{const n=config.priorities.indexOf(id??"");return n<0?Number.MAX_SAFE_INTEGER:n;};
 const deadline=Date.now()+2000;
 const sorted=[...items].sort((a,b)=>config.keep==="newest"?(Date.parse(b.publishedAt??"")||0)-(Date.parse(a.publishedAt??"")||0):config.keep==="priority"?rank(a.sourceId)-rank(b.sourceId):(Date.parse(a.detectedAt??"")||0)-(Date.parse(b.detectedAt??"")||0));
 const urls=new Map(sorted.map(i=>[i.url,canonical(i.url)]));
 const normalized=new Map(sorted.map(i=>[i.title,normalizedTitle(i.title)]));
 const titleTokens=new Map([...normalized.values()].map(t=>[t,new Set(t.split(" ").filter(w=>!new Set(["le","la","les","de","du","des","a","en","et","un","une","the","of","to","dans"]).has(w)))]));
 const scores=new Map<string,number>();
 const scoreTitles=(a:string,b:string)=>{const key=a+"\0"+b;const cached=scores.get(key);if(cached!==undefined)return cached;const left=titleTokens.get(normalized.get(a)!)!,right=titleTokens.get(normalized.get(b)!)!;const value=left.size&&right.size?2*[...left].filter(w=>right.has(w)).length/(left.size+right.size):0;if(scores.size<20000)scores.set(key,value);return value;};
 const kept:WatchItem[]=[],duplicates:{kept:string;removed:string;score:number}[]=[];
 for(const item of sorted){if(Date.now()>deadline)throw new AppError("SIMILARITY_LIMIT","Comparaison trop coûteuse : réduisez les sources ou utilisez le dédoublonnage par URL / titre.");let found:WatchItem|undefined,score=0;for(const previous of kept){score=urls.get(previous.url)===urls.get(item.url)?1:config.level==="url"?0:normalized.get(previous.title)===normalized.get(item.title)?1:config.level==="title"?0:scoreTitles(previous.title,item.title);if(config.level==="dated"&&urls.get(previous.url)!==urls.get(item.url)&&(!previous.publishedAt||!item.publishedAt||Math.abs(Date.parse(previous.publishedAt)-Date.parse(item.publishedAt))>config.dateHours*3600000))score=0;if(score>=config.threshold/100){found=previous;break;}}
 if(found)duplicates.push({kept:found.url,removed:item.url,score});else kept.push(item);}
 return {items:kept,duplicates};
}
export function processItems(items:WatchItem[],config:WatchConfig,now=Date.now()) {
 const matched=matchFilter(items,config.filter,now);const filtered=items.filter((_,i)=>matched[i]);const transformed=transform(filtered,config.transformations);const dedup=deduplicate(transformed,config.dedup);
 dedup.items.sort((a,b)=>{const time=(i:WatchItem)=>Date.parse((config.sort==="detected"?i.detectedAt:i.publishedAt)??"")||0;return config.sort==="oldest"?time(a)-time(b):time(b)-time(a);});
 return {analyzed:items.length,kept:dedup.items.length,excluded:items.length-filtered.length,duplicateCount:dedup.duplicates.length,items:dedup.items,duplicates:dedup.duplicates};
}
export function materialize(store:Store,id:string,override?:WatchConfig,now=Date.now(),path=new Set<string>(),memo=new Map<string,Analysis>()):Analysis|undefined {
 if(path.has(id)||path.size>=8)throw new AppError("FEED_CYCLE","Dépendance circulaire ou profondeur supérieure à 8 flux.");
 if(!override&&memo.has(id))return memo.get(id);
 const raw=store.get(id,true);if(!raw)return;const config=override??store.watch(id);const next=new Set([...path,id]);let items:WatchItem[];
 let modified=Math.max(Date.parse(raw.createdAt),Date.parse(config.updatedAt)||0);
 if(config.kind==="source")items=raw.items.map(item=>({...item,sourceId:item.sourceId??id,sourceName:item.sourceName??raw.title,sourceUrl:item.sourceUrl??raw.url,detectedAt:item.detectedAt??raw.createdAt}));
 else {items=[];for(const sourceId of config.sourceIds){const source=materialize(store,sourceId,undefined,now,next,memo);if(!source)throw new AppError("SOURCE_MISSING",`Source supprimée ou introuvable : ${sourceId}.`);modified=Math.max(modified,Date.parse(source.createdAt));items.push(...source.items);if(items.length>5000)throw new AppError("WATCH_LIMIT","L’agrégation dépasse 5000 articles. Réduisez le nombre de sources.");}}
 const processed=processItems(items,config,now);
 // Preserve separate syndicated copies without emitting duplicate RSS GUIDs.
 const guids=new Set<string>();processed.items=processed.items.map(item=>{let guid=item.guid;if(guids.has(guid))guid="urn:sha256:"+createHash("sha256").update((item.sourceId??"")+"|"+item.url+"|"+item.guid).digest("hex");guids.add(guid);return {...item,guid};});
 const output:Analysis={...raw,items:processed.items,createdAt:new Date(modified).toISOString(),detail:config.kind==="source"?raw.detail:`${config.sourceIds.length} source(s) · ${processed.excluded} exclus · ${processed.duplicateCount} doublons`,watchReport:{analyzed:processed.analyzed,kept:processed.kept,excluded:processed.excluded,duplicates:processed.duplicates}};
 if(!override)memo.set(id,output);return output;
}
