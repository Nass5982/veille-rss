import {mkdir,readFile,writeFile} from "node:fs/promises";
import {encryptState,emptyState} from "./state";
import {AppError} from "../errors";
export interface RemoteOptions {repository:string;token:string;directory:string;initialize?:boolean;secret?:string;request?:typeof fetch}
const branch="rss-state";
/** Git Data API commits only encrypted state. Never checks out or pushes local application files. */
export async function remoteState(command:"pull"|"push",options:RemoteOptions):Promise<void>{
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)||!options.token)throw new AppError("GITHUB_CONFIG","GITHUB_REPOSITORY et GH_TOKEN requis.");
 const request=options.request??fetch;const api=async(path:string,method="GET",data?:unknown,allowMissing=false):Promise<Record<string,any>>=>{
 const response=await request(`https://api.github.com/repos/${options.repository}${path}`,{method,headers:{Authorization:`Bearer ${options.token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(30000)});
 if(allowMissing&&response.status===404)return {missing:true};if(!response.ok)throw new AppError("GITHUB_STATE",`État GitHub : HTTP ${response.status}. Aucun historique n’est réinitialisé.`);return response.json();};
 const ref=await api(`/git/ref/heads/${branch}`,"GET",undefined,true);
 await mkdir(options.directory,{recursive:true});const statePath=`${options.directory}/state.enc`,metaPath=`${options.directory}/remote.json`;
 if(command==="pull") {
 if(ref.missing){if(!options.initialize||!options.secret)throw new AppError("STATE_MISSING","Branche rss-state absente. Autorisez explicitement initialize_state lors de la toute première exécution.");await writeFile(statePath,encryptState(emptyState(),options.secret),{mode:0o600});await writeFile(metaPath,JSON.stringify({sha:null}));return;}
 const commit=await api(`/git/commits/${ref.object.sha}`);const tree=await api(`/git/trees/${commit.tree.sha}`);const file=tree.tree?.find((entry:{path:string;type:string})=>entry.path==="state.enc"&&entry.type==="blob");if(!file)throw new AppError("STATE_MISSING","La branche existe mais state.enc manque : arrêt sans réinitialisation.");
 const blob=await api(`/git/blobs/${file.sha}`);if(blob.size>40000000||blob.encoding!=="base64")throw new AppError("STATE_SIZE","Blob d’état trop volumineux ou encodage inattendu.");const content=Buffer.from(blob.content,"base64");if(JSON.parse(content.toString()).format!=="source-rss-state-aes-gcm")throw new AppError("STATE_FORMAT","La branche doit contenir exclusivement un état chiffré.");await writeFile(statePath,content,{mode:0o600});await writeFile(metaPath,JSON.stringify({sha:ref.object.sha}));
 }else{
 const meta=JSON.parse(await readFile(metaPath,"utf8"));if((ref.missing?null:ref.object.sha)!==meta.sha)throw new AppError("STATE_CONFLICT","La branche d’état a changé. Relancez le workflow ; aucun écrasement forcé.");
 const text=await readFile(statePath,"utf8");if(JSON.parse(text).format!=="source-rss-state-aes-gcm"||Buffer.byteLength(text)>40000000)throw new AppError("STATE_FORMAT","Seul state.enc chiffré peut être envoyé.");
 const blob=await api("/git/blobs","POST",{content:Buffer.from(text).toString("base64"),encoding:"base64"});const tree=await api("/git/trees","POST",{tree:[{path:"state.enc",mode:"100644",type:"blob",sha:blob.sha}]});const commit=await api("/git/commits","POST",{message:"Update encrypted RSS state",tree:tree.sha,parents:meta.sha?[meta.sha]:[]});
 if(meta.sha)await api(`/git/refs/heads/${branch}`,"PATCH",{sha:commit.sha,force:false});else await api("/git/refs","POST",{ref:`refs/heads/${branch}`,sha:commit.sha});
 }
}
