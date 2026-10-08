import { getStore } from "@/lib/store";
import { feedResponse } from "@/lib/feed-response";
import { localRequest } from "@/lib/http";
import { asAppError } from "@/lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    localRequest(request);
    const { id } = await context.params;
    const feed = getStore().output(id);
    if (!feed) return new Response("Flux introuvable. Créez le flux depuis l’aperçu.", { status: 404 });
    const feedUrl = `http://${request.headers.get("host")}/feed/${id}`;
    return feedResponse(feed, feedUrl, request);
  } catch (error) { const failure = asAppError(error); return new Response(failure.message, { status: failure.status }); }
}
export const HEAD = GET;
