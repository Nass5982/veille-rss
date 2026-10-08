import { getStore } from "@/lib/store";
import { SafeFetcher } from "@/lib/network";
import { localRequest } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; index: string }> }): Promise<Response> {
  try {
    localRequest(request);
    const { id, index } = await context.params;
    if (!/^\d$/.test(index)) return new Response(null, { status: 404 });
    const url = getStore().get(id)?.items[Number(index)]?.image;
    if (!url) return new Response(null, { status: 404 });
    const image = await new SafeFetcher(request.signal).get(url);
    const type = image.headers["content-type"]?.split(";")[0];
    if (image.status !== 200 || !type || !/^image\/(png|jpeg|gif|webp|avif)$/.test(type)) return new Response(null, { status: 415 });
    return new Response(new Uint8Array(image.body), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch { return new Response(null, { status: 404 }); }
}
