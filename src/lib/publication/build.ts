import {mkdir,readdir,readFile,writeFile,rename,rm,lstat} from "node:fs/promises";
import {resolve,join,dirname,basename} from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {XMLParser} from "fast-xml-parser";
import {isPublicUrl} from "../public-url";
import {Store} from "../store";
import {refresh} from "../refresh";
import type {AnalyzeOptions} from "../engine";
import {canonical} from "../normalize";
import {generateRSS} from "../rss";
import {inspectRSS} from "../rss-diagnostic";
import {AppError} from "../errors";
import {publicBase,type PublicationConfig} from "./config";
import {type PublicationState} from "./state";
export function validateXML(xml:string,url:string,count?:number):number {
 const report=inspectRSS({url,status:200,headers:{"content-type":"application/rss+xml; charset=utf-8"},body:Buffer.from(xml,"utf8")},count??0);
 if(!report.ok)throw new AppError("RSS_INVALID",report.errors.join(" "));
 const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(xml);
 const self=parsed.rss?.channel?.["atom:link"]?.["@_href"];if(!self||!isPublicUrl(self)||!self.startsWith("https://"))throw new AppError("RSS_SELF","Le lien atom:self doit être une URL HTTPS publique absolue.");
 return report.itemCount;
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const identityKey=(url:string)=>createHash("sha256").update(canonical(url)).digest("hex");
export interface BuildReport {feeds:{id:string;slug:string;items:number;url:string}[];refreshes:{id:string;status:string;errorType?:string;newItems:number}[]}
/** Core engine/Store are reused with an in-memory SQLite adapter. JSON is the durable state. */
export async function buildPublication(config:PublicationConfig,previous:PublicationState,base:string,options:AnalyzeOptions={}):Promise<{state:PublicationState;files:Map<string,string>;report:BuildReport}> {
 base=publicBase(base);const store=new Store(":memory:");const deadline=Date.now()+18*60000;
 const report:BuildReport={feeds:[],refreshes:[]};const state:PublicationState={version:1,feeds:{...previous.feeds},updatedAt:new Date().toISOString()};
 try {
 for(const feed of config.feeds){const old=previous.feeds[feed.id];if(old&&(old.slug!==feed.publication.slug||old.sourceUrl!==feed.url))throw new AppError("STATE_IDENTITY",`Le slug ou la source du flux ${feed.id} a changé. Conservez-les, ou créez un nouvel identifiant.`);
 const analysis=old?.analysis??{id:feed.id,url:feed.url,title:feed.title,description:`Articles de ${new URL(feed.url).hostname}`,items:[],method:"html" as const,confidence:0,detail:"Initialisation autonome",createdAt:new Date().toISOString()};
 store.save({...analysis,title:feed.title,settings:feed.settings});store.publish(feed.id);store.setWatch(feed.id,feed.watch);const current=store.state(feed.id);store.setState(feed.id,{...current,settings:{...feed.settings,autoReanalyze:false}});if(old){store.remember(feed.id,old.seen);old.logs.forEach(log=>store.log(log));}}
 for(const feed of config.feeds.filter(f=>f.watch.kind==="source")){
 if(Date.now()>deadline)throw new AppError("BUILD_TIMEOUT","Budget global de 18 minutes atteint. Le site précédent reste disponible.");
 const log=await refresh(feed.id,{...options,store});report.refreshes.push({id:feed.id,status:log.status,errorType:log.errorType,newItems:log.newItems});
 const old=previous.feeds[feed.id];if(log.status==="error"&&!old?.analysis.items.length)throw new AppError("SOURCE_UNAVAILABLE",`Première extraction impossible pour ${feed.id} (${log.errorType}). Aucune publication partielle.`);
 // A known article retains its first GUID, date and detection timestamp across runs.
 const known=new Map(old?.analysis.items.map(i=>[canonical(i.url),i])??[]);const analysis=store.get(feed.id,true)!;
 analysis.items=analysis.items.map(item=>{const original=old?.identities?.[identityKey(item.url)]??known.get(canonical(item.url));return original?{...item,guid:original.guid,publishedAt:original.publishedAt??item.publishedAt,detectedAt:original.detectedAt??item.detectedAt}:item;});store.update(analysis);
 }
 const files=new Map<string,string>();
 for(const feed of config.feeds){const identities={...previous.feeds[feed.id]?.identities};for(const item of store.get(feed.id,true)!.items)identities[identityKey(item.url)]={guid:item.guid,publishedAt:item.publishedAt,detectedAt:item.detectedAt};state.feeds[feed.id]={identities,analysis:store.get(feed.id,true)!,logs:store.history(feed.id).slice(0,20),seen:store.seenKeys(feed.id),slug:feed.publication.slug,sourceUrl:feed.url};
 if(!feed.publication.publish)continue;const output=store.output(feed.id)!;const url=`${base}/feeds/${feed.publication.slug}.xml`;const xml=generateRSS(output,url);validateXML(xml,url,output.items.length);files.set(`feeds/${feed.publication.slug}.xml`,xml);report.feeds.push({id:feed.id,slug:feed.publication.slug,items:output.items.length,url});}
 files.set(".nojekyll","");files.set("index.html",`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Flux RSS</title><style>body{font:18px system-ui;max-width:850px;margin:4em auto;padding:1em;color:#163c32}li{margin:1.2em 0}a{color:#126951}</style></head><body><h1>Flux RSS</h1><p>Copiez le lien d’un flux dans Inoreader, Feedly ou votre lecteur RSS.</p><ul>${report.feeds.map(f=>`<li><a href="${escape(f.url)}">${escape(config.feeds.find(e=>e.id===f.id)!.title)}</a> · ${f.items} articles</li>`).join("")}</ul><p>Généré le ${escape(state.updatedAt)}. Les derniers articles connus sont conservés lorsqu’une source est momentanément indisponible.</p></body></html>`);
 return {state,files,report};
 } finally {store.close();}
}
/** Only allowlisted static files enter the Pages artifact, never a recursive copy of the project. */
export async function writePublication(directory:string,files:Map<string,string>):Promise<void>{
 const target=resolve(directory);if(target===resolve(".")||target===dirname(target))throw new AppError("OUTPUT_PATH","Dossier de sortie dangereux.");
 for(const path of files.keys())if(!/^(index\.html|\.nojekyll|feeds\/[a-z0-9][a-z0-9-]{0,99}\.xml)$/.test(path))throw new AppError("OUTPUT_FILE","Fichier non autorisé dans la publication.");
 try{await validateDirectory(target);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 const staging=join(dirname(target),`.rss-build-${randomUUID()}`);await mkdir(join(staging,"feeds"),{recursive:true});
 try{for(const [path,text]of files)await writeFile(join(staging,path),text,"utf8");const backup=target+".previous-"+randomUUID();let exists=false;try{await rename(target,backup);exists=true;}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 try{await rename(staging,target);}catch(e){if(exists)await rename(backup,target);throw e;}if(exists)await rm(backup,{recursive:true,force:true});
 }catch(e){await rm(staging,{recursive:true,force:true});throw e;}
}
export async function validateDirectory(directory:string,base?:string):Promise<number>{
 const root=await lstat(directory);if(!root.isDirectory()||root.isSymbolicLink())throw new AppError("OUTPUT_PATH","La sortie doit être un dossier réel.");
 const files=await readdir(directory);if(!files.includes("index.html")||!files.includes(".nojekyll")||files.some(f=>!["index.html",".nojekyll","feeds"].includes(f)))throw new AppError("OUTPUT_FILE","Sortie invalide : seuls index.html, .nojekyll et feeds/ sont autorisés.");
 for(const name of ["index.html",".nojekyll","feeds"]){const stat=await lstat(join(directory,name));if(stat.isSymbolicLink()||(name!=="feeds"&&!stat.isFile())||(name==="feeds"&&!stat.isDirectory()))throw new AppError("OUTPUT_FILE","Liens symboliques et fichiers non standards interdits.");}
 const names=await readdir(join(directory,"feeds"));if(!names.length)throw new AppError("OUTPUT_EMPTY","Aucun fichier XML généré.");
 for(const name of names){if(!/^[a-z0-9][a-z0-9-]{0,99}\.xml$/.test(name))throw new AppError("OUTPUT_FILE","Fichier inattendu dans feeds/.");const path=join(directory,"feeds",name),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3000000)throw new AppError("OUTPUT_SIZE","Flux trop volumineux ou fichier non standard.");const bytes=await readFile(path);const xml=new TextDecoder("utf-8",{fatal:true}).decode(bytes);validateXML(xml,`${base?publicBase(base):"https://publication.example.com"}/feeds/${basename(name)}`);}
 return names.length;
}
