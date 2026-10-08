import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/store";
import { refresh, acceptProposal } from "@/lib/refresh";
import { settings } from "@/lib/settings";
import { localRequest, smallJson } from "@/lib/http";
import { AppError, asAppError } from "@/lib/errors";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try{localRequest(request);const {id}=await params;const store=getStore();const feed=store.get(id,true);if(!feed)throw new AppError("NOT_FOUND","Flux introuvable.",404);return Response.json({feed:store.output(id),rawFeed:feed,watch:store.watch(id),state:store.state(id),history:store.history(id),proposal:store.proposal(id)},{headers:{"Cache-Control":"no-store"}});}catch(e){const error=asAppError(e);return Response.json({message:error.message},{status:error.status});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    localRequest(request,true);const {id}=await params;const input=await smallJson(request);const store=getStore();const feed=store.get(id,true);if(!feed)throw new AppError("NOT_FOUND","Flux introuvable.",404);
    if(store.locked())throw new AppError("BUSY","Une analyse est en cours. Attendez sa fin.",409);
    const state=store.state(id);
    switch(input.action) {
      case "refresh":case "reanalyze": {
        void refresh(id,{reanalyze:input.action==="reanalyze"}).catch(error=>console.error("Actualisation:",asAppError(error).message));return Response.json({message:"Actualisation en cours…"},{status:202});
      }
      case "save": {const config=settings(input.settings);const title=typeof input.title==="string"?input.title.trim().slice(0,500):feed.title;if(!title)throw new AppError("TITLE","Le nom est obligatoire.");store.update({...feed,title,settings:config});store.setState(id,{...state,settings:config,revision:state.revision+1,nextRunAt:state.enabled&&config.refreshMinutes?new Date(Date.now()+config.refreshMinutes*60000).toISOString():undefined});break;}
      case "toggle": {const enabled=!state.enabled;store.setState(id,{...state,enabled,status:enabled?"Actif":"Désactivé",nextRunAt:enabled&&state.settings.refreshMinutes?new Date(Date.now()+state.settings.refreshMinutes*60000).toISOString():undefined});break;}
      case "duplicate":{const copy={...feed,id:randomUUID(),title:feed.title+" (copie)",createdAt:new Date().toISOString(),settings:state.settings};store.save(copy);store.publish(copy.id);store.setWatch(copy.id,store.watch(id));return Response.json({id:copy.id});}
      case "delete":if(store.listPublished().some(f=>store.watch(f.id).sourceIds.includes(id)))throw new AppError("DEPENDENTS","Ce flux alimente un flux dérivé ou agrégé. Retirez-le de ses sources avant de le supprimer.",409);store.remove(id);break;
      case "accept":acceptProposal(id,store);break;
      case "reject":store.setProposal(id);break;
      default:throw new AppError("ACTION","Action inconnue.",400);
    }
    return Response.json({message:"Modification enregistrée."});
  }catch(e){const error=asAppError(e);return Response.json({code:error.code,message:error.message},{status:error.status});}
}
