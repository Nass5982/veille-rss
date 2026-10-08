import {readFile,mkdir,writeFile,stat} from "node:fs/promises";
import {resolve} from "node:path";
import {randomBytes} from "node:crypto";
import {publicationConfig,exportPublication,publicBase} from "../src/lib/publication/config";
import {buildPublication,writePublication,validateDirectory} from "../src/lib/publication/build";
import {readState,writeState,emptyState} from "../src/lib/publication/state";
import {Store} from "../src/lib/store";
const args=process.argv.slice(2);const command=args.shift()??"build";
const option=(name:string,fallback:string)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]??fallback;};
const configPath=resolve(option("--config","config/feeds.json"));const output=resolve(option("--output","public-rss"));
const statePath=resolve(option("--state",process.env.RSS_STATE_KEY?".rss-state/state.enc":".rss-state/state.json"));
async function main(){
try{
 if(command==="key")console.log(randomBytes(32).toString("base64"));
 else if(command==="export") {const store=new Store();try{const ids=option("--ids","").split(",").filter(Boolean);const text=exportPublication(store,ids.length?ids:store.listPublished().map(f=>f.id));await mkdir(resolve(configPath,".."),{recursive:true});await writeFile(configPath,text,"utf8");console.log(`Configuration exportée : ${configPath}. Vérifiez son contenu avant de la versionner.`);}finally{store.close();}}
 else if(command==="validate")console.log(`${await validateDirectory(output,process.env.RSS_PUBLIC_BASE_URL)} flux RSS valides. Sortie statique contrôlée.`);
 else if(command==="build"||command==="seed") {
 const config=publicationConfig(await readFile(configPath,"utf8"));
 if(process.env.GITHUB_ACTIONS==="true"&&!process.env.RSS_STATE_KEY)throw new Error("RSS_STATE_KEY est obligatoire dans GitHub Actions.");
 if(command==="seed") {
 if(!process.env.RSS_STATE_KEY)throw new Error("RSS_STATE_KEY requis pour exporter un état local chiffré.");
 try{await stat(statePath);throw new Error("Le fichier d’état existe déjà. Choisissez un nouveau chemin --state.");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 const store=new Store();try{const state=emptyState();for(const feed of config.feeds){const analysis=store.get(feed.id,true);if(!analysis)throw new Error(`Flux local introuvable : ${feed.id}`);state.feeds[feed.id]={analysis,seen:store.seenKeys(feed.id),logs:store.history(feed.id).slice(0,20),slug:feed.publication.slug,sourceUrl:feed.url};}await writeState(statePath,state,process.env.RSS_STATE_KEY);console.log("État local chiffré exporté. Ne publiez jamais la clé.");}finally{store.close();}
 }else{
 const base=publicBase(option("--base-url",process.env.RSS_PUBLIC_BASE_URL??""));
 const previous=await readState(statePath,process.env.RSS_STATE_KEY,process.env.GITHUB_ACTIONS!=="true");
 const result=await buildPublication(config,previous,base);await writePublication(output,result.files);await validateDirectory(output,base);await writeState(statePath,result.state,process.env.RSS_STATE_KEY);
 await writeFile(resolve(statePath,"..","report.json"),JSON.stringify(result.report,null,2),{mode:0o600});
 for(const f of result.report.feeds)console.log(`${f.slug}.xml : ${f.items} articles — ${f.url}`);
 for(const r of result.report.refreshes)if(r.status==="error")console.warn(`Source ${r.id} : ${r.errorType}. Articles précédents conservés.`);
 console.log(`${result.report.feeds.length} flux validés. Aucun serveur Next.js utilisé.`);
 }}else throw new Error("Commande inconnue : build, validate, export, seed ou key.");
}catch(error){console.error(error instanceof Error?error.message:"Échec du générateur autonome.");process.exitCode=1;}

}
void main();
