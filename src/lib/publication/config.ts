import { parseJSON, exportJSON, type ImportEntry } from "../interchange";
import { parseRemoteUrl } from "../network";
import { AppError } from "../errors";
import type { Store } from "../store";
export interface PublicationFeed extends ImportEntry { publication:{slug:string;publish:boolean} }
export interface PublicationConfig { format:"source-rss";version:1;feeds:PublicationFeed[] }
export function publicBase(value:string):string {
  if(value.includes("#"))throw new AppError("PUBLIC_URL","L’URL publique ne doit pas contenir de fragment.");
  const url=parseRemoteUrl(value);
  if(url.protocol!=="https:"||url.search||url.hash)throw new AppError("PUBLIC_URL","RSS_PUBLIC_BASE_URL doit être une URL HTTPS publique sans paramètres.");
  return url.href.replace(/\/$/,"");
}
function checkSensitive(value:unknown):void {
  if(typeof value==="string") {
    if(/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[\w]{30,}|Bearer\s+\S+|-----BEGIN .*PRIVATE KEY-----)/i.test(value))throw new AppError("SECRET_CONFIG","Configuration refusée : secret potentiel. Ne versionnez pas de jeton.");
    for(const match of value.matchAll(/https?:\/\/[^\s<>"']+/g)){let url:URL;try{url=new URL(match[0]);}catch{continue;}if(url.username||url.password||[...url.searchParams.keys()].some(key=>/token|secret|password|signature|api.?key|credential|authorization|cookie/i.test(key)))throw new AppError("SECRET_CONFIG","Une URL de configuration semble contenir un identifiant ou un jeton.");}
  } else if(Array.isArray(value))value.forEach(checkSensitive);
  else if(value&&typeof value==="object")for(const [key,entry]of Object.entries(value)){if(/^(password|secret|token|cookies?|authorization|api.?key)$/i.test(key))throw new AppError("SECRET_CONFIG","Champ sensible interdit dans la configuration publique.");checkSensitive(entry);}
}
export function publicationConfig(text:string):PublicationConfig {
  if(Buffer.byteLength(text)>1000000)throw new AppError("CONFIG_SIZE","Configuration limitée à 1 Mo.");
  let raw:{feeds?:Record<string,unknown>[]};try{raw=JSON.parse(text);}catch{throw new AppError("CONFIG_JSON","Configuration JSON invalide.");}
  checkSensitive(raw);
  const entries=parseJSON(text);
  if(!entries.length||entries.length>30)throw new AppError("CONFIG_LIMIT","Choisir entre 1 et 30 flux (sources et agrégats inclus).");
  const slugs=new Set<string>();
  const feeds=entries.map((entry,index)=>{
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(entry.id))throw new AppError("CONFIG_ID","Identifiant de flux invalide.");
    const p=raw.feeds?.[index].publication as {slug?:unknown;publish?:unknown}|undefined;
    const slug=p?.slug??entry.id,publish=p?.publish??true;
    if(typeof slug!=="string"||!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)||slugs.has(slug)||typeof publish!=="boolean")throw new AppError("CONFIG_SLUG","Slugs uniques requis : lettres minuscules, chiffres, tirets (100 caractères maximum).");
    slugs.add(slug);
    // Validation does not turn reading the same config into a content update.
    const watch=raw.feeds?.[index].watch as {updatedAt?:string}|undefined;
    entry.watch.updatedAt=watch?.updatedAt&&Number.isFinite(Date.parse(watch.updatedAt))?watch.updatedAt:"2000-01-01T00:00:00.000Z";
    return {...entry,publication:{slug,publish}};
  });
  if(!feeds.some(f=>f.publication.publish))throw new AppError("CONFIG_EMPTY","Aucun flux sélectionné pour publication.");
  return {format:"source-rss",version:1,feeds};
}
export function exportPublication(store:Store,ids:string[]):string {
  const data=JSON.parse(exportJSON(store,ids));
  for(const feed of data.feeds)feed.publication={slug:feed.id.toLowerCase(),publish:ids.includes(feed.id)};
  // Do not export cookies, articles, logs, SQLite or local tunnel state.
  return JSON.stringify(publicationConfig(JSON.stringify(data)),null,2)+"\n";
}
