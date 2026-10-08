import { XMLParser,XMLValidator,XMLBuilder } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import { AppError } from "./errors";
import { parseRemoteUrl } from "./network";
import { settings,type Settings } from "./settings";
import { watchConfig } from "./watch-config";
import { watchDefaults,type WatchConfig } from "./watch-types";
export interface ImportEntry {id:string;title:string;url:string;settings:Settings;watch:WatchConfig}
export function parseOPML(xml:string):ImportEntry[] {
 if(Buffer.byteLength(xml)>1000000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true)throw new AppError("OPML_INVALID","OPML invalide, trop volumineux ou contenant des entités interdites.");
 const parsed=new XMLParser({ignoreAttributes:false,processEntities:true}).parse(xml);if(!parsed.opml?.body)throw new AppError("OPML_INVALID","Le fichier doit contenir opml/body.");const entries:ImportEntry[]=[];let count=0;
 const walk=(input:unknown,folder:string[],depth=0)=>{if(depth>8)throw new AppError("OPML_LIMIT","Dossiers OPML trop profondément imbriqués.");for(const item of Array.isArray(input)?input:input?[input]:[]){if(++count>500)throw new AppError("OPML_LIMIT","Maximum 500 rubriques et 200 flux.");if(!item||typeof item!=="object")continue;const row=item as Record<string,unknown>;const name=String(row["@_title"]??row["@_text"]??"Sans nom").slice(0,500);const url=row["@_xmlUrl"]??row["@_xmlurl"];
 if(url){if(entries.length>=200)throw new AppError("OPML_LIMIT","Maximum 200 flux par import.");const config=watchDefaults();config.folder=folder.join(" / ").slice(0,200);entries.push({id:randomUUID(),title:name,url:parseRemoteUrl(String(url)).href,settings:settings({method:"rss"}),watch:config});}
 if(row.outline)walk(row.outline,[...folder,name],depth+1);
 }};walk(parsed.opml.body.outline,[]);if(!entries.length)throw new AppError("OPML_EMPTY","Aucun flux avec xmlUrl trouvé.");return entries;
}
export function exportOPML(store:Store,ids:string[],base:string):string {
 const roots:Record<string,unknown>[]=[];const folders=new Map<string,Record<string,unknown>>();
 for(const id of ids){const feed=store.get(id,true);if(!feed)continue;const folder=store.watch(id).folder;let list=roots,path="";for(const name of folder.split(" / ").filter(Boolean)){path+=(path?" / ":"")+name;let node=folders.get(path);if(!node){node={"@_text":name,outline:[]};list.push(node);folders.set(path,node);}list=node.outline as Record<string,unknown>[];}
 list.push({"@_type":"rss","@_text":feed.title,"@_title":feed.title,"@_xmlUrl":`${base}/feed/${id}`,"@_htmlUrl":feed.url});}
 return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLBuilder({ignoreAttributes:false,format:true}).build({opml:{"@_version":"2.0",head:{title:"Source — Mes flux"},body:{outline:roots}}});
}
export function exportJSON(store:Store,ids:string[]):string {
 // Include dependencies so selecting an aggregate still yields a restorable backup.
 const selected=new Set(ids);const add=(id:string)=>{for(const source of store.watch(id).sourceIds)if(!selected.has(source)){selected.add(source);add(source);}};ids.forEach(add);
 return JSON.stringify({format:"source-rss",version:1,exportedAt:new Date().toISOString(),feeds:[...selected].map(id=>{const f=store.get(id,true);return f?{id,title:f.title,url:f.url,settings:store.state(id).settings,watch:store.watch(id)}:undefined;}).filter(Boolean)},null,2);
}
export function parseJSON(text:string):ImportEntry[] {
 if(Buffer.byteLength(text)>1000000)throw new AppError("IMPORT_SIZE","Maximum 1 Mo.");let data:unknown;try{data=JSON.parse(text);}catch{throw new AppError("JSON_INVALID","JSON invalide.");}
 const value=data as {format?:string;version?:number;feeds?:unknown[]};if(value?.format!=="source-rss"||value.version!==1||!Array.isArray(value.feeds)||value.feeds.length>200)throw new AppError("JSON_FORMAT","Export Source version 1 attendu, maximum 200 flux.");
 const entries=value.feeds.map(value=>{const row=value as Record<string,unknown>;if(!row||typeof row.id!=="string"||!row.id||typeof row.title!=="string"||!row.title.trim()||row.title.length>500||typeof row.url!=="string")throw new AppError("JSON_FEED","Flux importé invalide.");return {id:row.id,title:row.title,url:parseRemoteUrl(row.url).href,settings:settings(row.settings),watch:watchConfig(row.watch)};});
 const ids=new Set(entries.map(e=>e.id));if(ids.size!==entries.length)throw new AppError("JSON_IDS","Identifiants dupliqués.");
 const visit=(id:string,path=new Set<string>())=>{if(path.has(id)||path.size>=8)throw new AppError("FEED_CYCLE","Dépendances cycliques ou trop profondes.");const row=entries.find(e=>e.id===id);if(!row)throw new AppError("SOURCE_MISSING","Une source nécessaire manque dans l’export.");for(const source of row.watch.sourceIds)visit(source,new Set([...path,id]));};entries.forEach(e=>visit(e.id));return entries;
}
export function importEntries(store:Store,entries:ImportEntry[]):string[] {
 const mapped=new Map<string,string>(entries.map(e=>[e.id,randomUUID()]));return store.transaction(()=>entries.map(entry=>{
 const id=mapped.get(entry.id)!;const watch={...entry.watch,updatedAt:new Date().toISOString(),sourceIds:entry.watch.sourceIds.map(id=>mapped.get(id)!),dedup:{...entry.watch.dedup,priorities:entry.watch.dedup.priorities.map(id=>mapped.get(id)).filter((id):id is string=>!!id)}};
 store.save({id,url:entry.url,title:entry.title,description:`Veille : ${entry.title}`,items:[],method:entry.settings.method==="auto"?"html":entry.settings.method,confidence:0,detail:"Importé : actualisez la source pour récupérer les articles.",createdAt:new Date().toISOString(),settings:entry.settings});store.publish(id);store.setWatch(id,watch);return id;
 }));
}
