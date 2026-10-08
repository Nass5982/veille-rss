import { analyze } from "@/lib/engine";
import { preview,testSnapshot } from "@/lib/editor";
import { settings } from "@/lib/settings";
import { getStore } from "@/lib/store";
import { localRequest,smallJson,acquire } from "@/lib/http";
import { parseRemoteUrl } from "@/lib/network";
import { AppError,asAppError } from "@/lib/errors";
export const runtime="nodejs";
export async function POST(request:Request) {
  let release:(()=>void)|undefined;
  try {
    localRequest(request,true);const input=await smallJson(request);const config=settings(input.settings ?? {});
    if(input.action==="selectors") {if(typeof input.token!=="string" || !config.manual)throw new AppError("INPUT","Chargez un aperçu et définissez une règle.");return Response.json(testSnapshot(input.token,config.manual,config.timezone));}
    if(typeof input.url!=="string")throw new AppError("URL","URL requise.");const url=parseRemoteUrl(input.url).href;release=acquire();
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(180000)]);
    if(input.action==="preview")return Response.json(await preview(url,config,signal));
    if(input.action!=="test")throw new AppError("ACTION","Action inconnue.");
    const events:import("@/lib/types").ProgressEvent[]=[];const analysis=await analyze(url,e=>events.push(e),{settings:config,signal});getStore().save(analysis);return Response.json({analysis,events});
  }catch(e){const error=asAppError(e);return Response.json({code:error.code,message:error.message},{status:error.status});}finally{release?.();}
}
