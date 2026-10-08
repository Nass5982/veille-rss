import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {readFile,writeFile,mkdir,rename,stat} from "node:fs/promises";
import {gzipSync,gunzipSync} from "node:zlib";
import {dirname} from "node:path";
import type {Analysis} from "../types";
import type {RefreshLog} from "../store";
import {AppError} from "../errors";
export interface ArticleIdentity {guid:string;publishedAt?:string;detectedAt?:string}
export interface FeedMemory {identities?:Record<string,ArticleIdentity>;analysis:Analysis;seen:string[];logs:RefreshLog[];slug:string;sourceUrl:string}
export interface PublicationState {version:1;feeds:Record<string,FeedMemory>;updatedAt:string}
export const emptyState=():PublicationState=>({version:1,feeds:{},updatedAt:new Date().toISOString()});
function key(value:string):Buffer {if(!/^[A-Za-z0-9+/]{43}=$/.test(value)||Buffer.from(value,"base64").length!==32)throw new AppError("STATE_KEY","RSS_STATE_KEY doit être une clé aléatoire de 32 octets encodée en base64.");return Buffer.from(value,"base64");}
export function encryptState(state:PublicationState,secret:string):string {
 const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",key(secret),iv);cipher.setAAD(Buffer.from("source-rss-state-v1"));const data=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(state)))),cipher.final()]);return JSON.stringify({format:"source-rss-state-aes-gcm",version:1,compression:"gzip",iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:data.toString("base64")});
}
export function decodeState(text:string,secret?:string):PublicationState {
 try{const parsed=JSON.parse(text);let state:PublicationState;
 if(parsed.format==="source-rss-state-aes-gcm") {if(!secret)throw new AppError("STATE_KEY","Clé requise pour lire l’état chiffré.");const decipher=createDecipheriv("aes-256-gcm",key(secret),Buffer.from(parsed.iv,"base64"));decipher.setAAD(Buffer.from("source-rss-state-v1"));decipher.setAuthTag(Buffer.from(parsed.tag,"base64"));const bytes=Buffer.concat([decipher.update(Buffer.from(parsed.data,"base64")),decipher.final()]);state=JSON.parse((parsed.compression==="gzip"?gunzipSync(bytes,{maxOutputLength:40000000}):bytes).toString("utf8"));}
 else {if(secret)throw new AppError("STATE_FORMAT","État non chiffré refusé lorsque RSS_STATE_KEY est défini.");state=parsed;}
 if(state.version!==1||!state.feeds||typeof state.feeds!=="object"||Array.isArray(state.feeds)||Object.keys(state.feeds).length>100)throw new Error("state");
 for(const [id,feed]of Object.entries(state.feeds))if(feed.analysis?.id!==id||!Array.isArray(feed.analysis.items)||feed.analysis.items.length>500||!Array.isArray(feed.seen)||!Array.isArray(feed.logs)||typeof feed.slug!=="string")throw new Error("feed");
 return state;
 }catch(e){if(e instanceof AppError)throw e;throw new AppError("STATE_CORRUPT","État corrompu ou mauvaise clé : aucune réinitialisation automatique. Restaurez une sauvegarde.");}
}
export async function readState(path:string,secret?:string,initialize=false):Promise<PublicationState> {
 try{if((await stat(path)).size>40_000_000)throw new AppError("STATE_SIZE","État trop volumineux (40 Mo maximum).");return decodeState(await readFile(path,"utf8"),secret);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT"&&initialize)return emptyState();throw e;}
}
export async function atomicWrite(path:string,text:string):Promise<void>{await mkdir(dirname(path),{recursive:true});const temporary=path+".tmp-"+randomBytes(6).toString("hex");await writeFile(temporary,text,{mode:0o600});await rename(temporary,path);}
export async function writeState(path:string,state:PublicationState,secret?:string):Promise<void>{const plain=JSON.stringify(state);if(Buffer.byteLength(plain)>40000000)throw new AppError("STATE_SIZE","État décodé supérieur à 40 Mo ; sauvegarde précédente conservée.");const text=secret?encryptState(state,secret):plain;if(Buffer.byteLength(text)>40_000_000)throw new AppError("STATE_SIZE","L’état dépasse 40 Mo ; aucune sauvegarde n’a été écrasée.");await atomicWrite(path,text);}
