import { localRequest } from "@/lib/http";
import { AppError, asAppError } from "@/lib/errors";
import { getStore } from "@/lib/store";
import { readTunnelState } from "@/lib/tunnel-state";
import { diagnosePublicFeed } from "@/lib/rss-diagnostic";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    localRequest(request, true);
    const { id } = await context.params;
    const feed = getStore().output(id);
    if (!feed) throw new AppError("NOT_FOUND", "Flux publié introuvable.", 404);
    const tunnel = readTunnelState();
    if (!tunnel?.publicUrl || tunnel.status === "stopped") throw new AppError("TUNNEL_INACTIVE", "Aucun tunnel actif. Une URL localhost n’est pas accessible à Inoreader ou Feedly.");
    const report = await diagnosePublicFeed(`${tunnel.publicUrl}/feed/${id}`, feed.items.length);
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const e = asAppError(error); return Response.json({ message: e.message, code: e.code }, { status: e.status }); }
}
