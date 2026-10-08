import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/store";
import { localRequest,smallJson } from "@/lib/http";
import { AppError,asAppError } from "@/lib/errors";
import { watchConfig } from "@/lib/watch-config";
import { materialize,processItems } from "@/lib/watch";
import { parseJSON,parseOPML,importEntries,exportJSON,exportOPML } from "@/lib/interchange";
import { exportPublication } from "@/lib/publication/config";
import { readTunnelState } from "@/lib/tunnel-state";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{localRequest(request);const store=getStore();const url=new URL(request.url);const format=url.searchParams.get("export");if(format){const selected=url.searchParams.get("ids")?.split(",");const folder=url.searchParams.get("folder");const ids=store.listPublished().filter(f=>(!selected||selected.includes(f.id))&&(folder===null||store.watch(f.id).folder===folder)).map(f=>f.id);const tunnel=readTunnelState();const base=tunnel?.status==="active"&&tunnel.publicUrl?tunnel.publicUrl:`http://${request.headers.get("host")}`;return new Response(format==="opml"?exportOPML(store,ids,base):format==="github"?exportPublication(store,ids):exportJSON(store,ids),{headers:{"Content-Type":format==="opml"?"text/x-opml; charset=utf-8":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="source-flux.${format==="opml"?"opml":"json"}"`,"Cache-Control":"no-store"}});}
 if(url.searchParams.has("favorites"))return Response.json({favorites:store.favorites()});
 const rows=store.listPublished().map(feed=>{try{return {feed:store.output(feed.id),raw:feed,state:store.state(feed.id),watch:store.watch(feed.id)};}catch(e){return {feed,raw:feed,state:store.state(feed.id),watch:store.watch(feed.id),error:asAppError(e).message};}});return Response.json({rows,favorites:store.favorites()},{headers:{"Cache-Control":"no-store"}});
 }catch(e){const error=asAppError(e);return Response.json({message:error.message},{status:error.status});}}
export async function POST(request:Request){try{
 localRequest(request,true);const input=await smallJson(request,1100000);const store=getStore();
 if(input.action==="import"){if(store.locked())throw new AppError("BUSY","Attendez la fin de l’actualisation.",409);if(typeof input.text!=="string")throw new AppError("IMPORT","Fichier manquant.");const entries=input.format==="opml"?parseOPML(input.text):parseJSON(input.text);return Response.json({ids:importEntries(store,entries),message:`${entries.length} flux importés. Actualisez les sources pour télécharger leurs articles.`});}
 if(input.action==="articleFavorite"){if(typeof input.url!=="string")throw new AppError("INPUT","URL requise.");if(input.enabled===false){const item=store.favorites().find(i=>i.url===input.url);if(item)store.favorite(item,false);}else{if(typeof input.id!=="string")throw new AppError("INPUT","Flux requis.");const item=store.output(input.id)?.items.find(i=>i.url===input.url);if(!item)throw new AppError("NOT_FOUND","Article introuvable.",404);store.favorite(item,true);}return Response.json({message:"Favori enregistré."});}
 if(typeof input.id!=="string")throw new AppError("INPUT","Identifiant du flux requis.");const id=input.id;const raw=store.get(id,true);if(!raw)throw new AppError("NOT_FOUND","Flux introuvable.",404);
 if(input.action==="favorite"){store.setWatch(id,{...store.watch(id),favorite:input.enabled===true});return Response.json({message:"Favori enregistré."});}
 const config=watchConfig(input.config);for(const source of config.sourceIds)if(!store.get(source,true))throw new AppError("SOURCE_MISSING","Source introuvable.");
 if(input.action==="preview"){const result=input.creating?(()=>{const items=config.sourceIds.flatMap(source=>store.output(source)!.items);if(items.length>5000)throw new AppError("WATCH_LIMIT","Maximum 5000 articles agrégés.");const p=processItems(items,config);return {...raw,items:p.items,watchReport:{analyzed:p.analyzed,kept:p.kept,excluded:p.excluded,duplicates:p.duplicates}};})():materialize(store,id,config);return Response.json({feed:result,report:result?.watchReport});}
 if(input.action==="save"){materialize(store,id,config);store.setWatch(id,config);return Response.json({message:"Règles enregistrées. Le RSS est mis à jour sans extraction."});}
 if(input.action==="create"){if(config.kind==="source")throw new AppError("KIND","Utilisez l’analyse pour créer une nouvelle source.");const title=typeof input.title==="string"?input.title.trim().slice(0,500):"";if(!title)throw new AppError("TITLE","Le nom est obligatoire.");const next=randomUUID();const sample=store.get(config.sourceIds[0],true)!;
 store.transaction(()=>{store.save({...sample,id:next,title,items:[],createdAt:new Date().toISOString(),settings:{...store.state(sample.id).settings,refreshMinutes:0}});store.publish(next);store.setWatch(next,config);materialize(store,next);});return Response.json({id:next});}
 throw new AppError("ACTION","Action inconnue.");
 }catch(e){const error=asAppError(e);return Response.json({code:error.code,message:error.message},{status:error.status});}}
