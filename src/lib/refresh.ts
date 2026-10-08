import { randomUUID } from "node:crypto";
import { analyze, type AnalyzeOptions } from "./engine";
import { Store, getStore, type RefreshLog } from "./store";
import { AppError, asAppError } from "./errors";
import { normalize, canonical } from "./normalize";
import type { Analysis } from "./types";
import { settings } from "./settings";
export function errorCategory(code:string):string {return ({DNS:"DNS_ERROR",SSL:"SSL_ERROR",AUTH:"AUTH_REQUIRED",EMPTY:"EMPTY_RESULT",BROWSER_TIMEOUT:"TIMEOUT",BROWSER_MISSING:"JAVASCRIPT_ERROR",EXTRACTION:"UNKNOWN",NETWORK:"UNKNOWN"} as Record<string,string>)[code] ?? code;}
export function statusFor(code:string):string {return /SELECTOR/.test(code)?"Sélecteur cassé":/CAPTCHA|CLOUDFLARE/.test(code)?"Bloqué par anti-bot":code==="AUTH_REQUIRED"?"Authentification requise":/HTTP|DNS|SSL|TIMEOUT/.test(code)?"Site inaccessible":"Erreur";}
export async function refresh(id:string, options:AnalyzeOptions & {store?:Store; reanalyze?:boolean}={}):Promise<RefreshLog> {
  const store=options.store ?? getStore(); const old=store.get(id,true);if(!old)throw new AppError("NOT_FOUND","Flux introuvable.",404);
  const release=store.lease();if(!release)throw new AppError("BUSY","Une analyse ou actualisation est déjà en cours.",409);
  const state=store.state(id); const start=Date.now();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),180000);
  const log:RefreshLog={id:randomUUID(),feedId:id,startedAt:new Date(start).toISOString(),status:"running",itemsFound:0,newItems:0,events:[]};
  const emit=(e:import("./types").ProgressEvent)=>{log.events.push({...e,at:new Date().toISOString()}); const match=/HTTP (\d{3})/.exec(e.message);if(match)log.httpStatus=+match[1];store.log(log);};
  store.setState(id,{...state,status:"Actualisation en cours"});store.log(log);
  const propose=async()=>{
    const config=settings({...state.settings,method:"auto",manual:undefined});
    const candidate=await analyze(old.url,emit,{...options,signal:controller.signal,settings:config});
    const urls=new Set(old.items.map(i=>canonical(i.url)));const overlap=candidate.items.filter(i=>urls.has(canonical(i.url))).length/Math.max(1,candidate.items.length);
    store.setProposal(id,{analysis:candidate,settings:config,overlap,revision:state.revision,previousCount:log.itemsFound,createdAt:new Date().toISOString()});
    emit({step:"proposal",status:"success",message:"Une nouvelle méthode d’extraction a été détectée. Votre validation est requise avant adoption."});
  };
  try {
    emit({step:"start",status:"running",message:"Démarrage"});
    if(store.watch(id).kind!=="source"){const result=store.output(id)!;log.method="aggregate";log.itemsFound=result.items.length;log.newItems=store.remember(id,result.items.map(i=>canonical(i.url)));log.status="success";emit({step:"aggregate",status:"success",message:"Flux recalculé depuis les articles stockés, sans nouvelle extraction."});}
    else if(options.reanalyze){await propose();log.status="proposal";}
    else {
      const result=await analyze(old.url,emit,{...options,signal:controller.signal,settings:state.settings});log.method=result.method;log.itemsFound=result.items.length;
      const previous=store.history(id).filter(l=>l.status==="success").slice(0,5);const average=previous.length?previous.reduce((n,l)=>n+l.itemsFound,0)/previous.length:old.items.length;
      if(average>=10 && result.items.length<average*.2)throw new AppError("SELECTOR_BROKEN",`Extraction probablement cassée : moyenne habituelle ${Math.round(average)} articles, résultat actuel ${result.items.length}. Les articles connus sont conservés.`);
      log.newItems=store.remember(id,result.items.map(i=>canonical(i.url)));
      const oldByUrl=new Map(old.items.map(i=>[i.url,i]));
      const detected=result.items.map(i=>({...i,detectedAt:oldByUrl.get(i.url)?.detectedAt ?? new Date(start).toISOString()}));
      const merged=normalize([...detected,...old.items],old.url,{maxItems:500});store.update({...result,id,title:old.title,items:merged});store.setProposal(id);
      log.status="success";emit({step:"save",status:"success",message:`${log.newItems} nouveaux articles enregistrés · RSS mis à jour`});
    }
  } catch(error) {
    const e=asAppError(error);log.status="error";log.errorType=errorCategory(e.code);log.errorMessage=e.message;
    if((log.errorType==="EMPTY_RESULT" || log.errorType==="SELECTOR_BROKEN") && old.items.length){log.errorType="SELECTOR_BROKEN";log.errorMessage=`Extraction probablement cassée : ${old.items.length} articles connus, ${log.itemsFound} récupérés. ${e.message}`;}
    emit({step:"error",status:"error",message:`${log.errorType} — ${log.errorMessage}`});
    if(state.settings.autoReanalyze && !options.reanalyze && !controller.signal.aborted && ["SELECTOR_BROKEN","API_ERROR","RSS_INVALID"].includes(log.errorType))try{await propose();}catch(failure){emit({step:"proposal",status:"warning",message:`Réanalyse sans solution : ${asAppError(failure).message}`});}
  } finally {
    clearTimeout(timer); log.finishedAt=new Date().toISOString();log.durationMs=Date.now()-start;store.log(log);
    const latest=store.state(id);store.setState(id,{...latest,status:!latest.enabled?"Désactivé":log.status==="error"?statusFor(log.errorType!):"Actif",lastRunAt:log.finishedAt,newItems:log.newItems,nextRunAt:latest.enabled&&latest.settings.refreshMinutes?new Date(Date.now()+latest.settings.refreshMinutes*60000).toISOString():undefined});release();
  }
  return log;
}
export function acceptProposal(id:string,store=getStore()):Analysis {
  const proposal=store.proposal(id);if(!proposal)throw new AppError("PROPOSAL","Aucune proposition disponible.",404);
  if(store.locked())throw new AppError("BUSY","Attendez la fin de l’analyse.",409);
  const state=store.state(id);if(proposal.revision!==state.revision)throw new AppError("STALE","Les réglages ont changé. Relancez une réanalyse.",409);
  const old=store.get(id,true)!;const result={...proposal.analysis,id,title:old.title,items:normalize([...proposal.analysis.items,...old.items],old.url,{maxItems:500})};
  const newItems=store.remember(id,proposal.analysis.items.map(i=>canonical(i.url)));store.update(result);store.setState(id,{...state,settings:proposal.settings,revision:state.revision+1,status:"Actif",newItems});store.setProposal(id);
  store.log({id:randomUUID(),feedId:id,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),status:"adopted",method:result.method,itemsFound:proposal.analysis.items.length,newItems,events:[{step:"adopt",status:"success",message:"Nouvelle méthode adoptée explicitement par l’utilisateur.",at:new Date().toISOString()}]});return result;
}
export async function schedulerTick(store=getStore(), now=Date.now(), runner:typeof refresh=refresh):Promise<void> {
  if(store.locked())return;
  for(const feed of store.listPublished()) {if(store.watch(feed.id).kind!=="source")continue;const state=store.state(feed.id);
    if(state.status==="Actualisation en cours") {store.setState(feed.id,{...state,status:"Erreur"});const interrupted=store.history(feed.id).find(l=>l.status==="running");if(interrupted)store.log({...interrupted,status:"error",finishedAt:new Date(now).toISOString(),errorType:"INTERRUPTED",errorMessage:"Le serveur a été arrêté pendant l’actualisation."});}
    if(state.enabled && state.settings.refreshMinutes && state.nextRunAt && Date.parse(state.nextRunAt)<=now){await runner(feed.id,{store});break;}
  }
}
export function startScheduler():void {
  const global=globalThis as typeof globalThis & {rssScheduler?:ReturnType<typeof setInterval>;rssTick?:boolean};if(global.rssScheduler)return;
  const tick=async()=>{if(global.rssTick)return;global.rssTick=true;try{await schedulerTick();}catch(error){console.error("Planificateur RSS:",asAppError(error).message);}finally{global.rssTick=false;}};
  global.rssScheduler=setInterval(()=>void tick(),15000);global.rssScheduler.unref();void tick();
}
