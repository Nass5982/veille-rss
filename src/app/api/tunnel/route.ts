import { localRequest, smallJson } from "@/lib/http";
import { AppError, asAppError } from "@/lib/errors";
import { readTunnelState, requestTunnelStop } from "@/lib/tunnel-state";
import { startTunnelProcess } from "@/lib/tunnel-process";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inactive = { status: "stopped", message: "Aucun tunnel actif.", provider: "cloudflare" };
export async function GET(request: Request) {
  try { localRequest(request); return Response.json(readTunnelState() ?? inactive, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { const e = asAppError(error); return Response.json({ message: e.message }, { status: e.status }); }
}
export async function POST(request: Request) {
  try {
    localRequest(request, true);
    const { action, provider = "cloudflare" } = await smallJson(request);
    if (action === "stop") { const state = readTunnelState(); if (state) requestTunnelStop(state.runId); return Response.json({ message: "Arrêt demandé. La passerelle va se fermer sous quelques secondes." }); }
    if (action !== "start" || !["cloudflare", "ngrok", "named"].includes(String(provider))) throw new AppError("INPUT", "Action ou fournisseur de tunnel invalide.", 400);
    const started = await startTunnelProcess(provider as "cloudflare" | "ngrok" | "named");
    return Response.json({ message: started ? "Démarrage demandé. L’état est actualisé automatiquement." : "Un tunnel est déjà lancé et réessaie automatiquement en cas de coupure. Pour le relancer ou changer de fournisseur, arrêtez-le d’abord." }, { status: started ? 202 : 200 });
  } catch (error) { const e = asAppError(error); return Response.json({ message: e.message }, { status: e.status }); }
}
