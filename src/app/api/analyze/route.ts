import { settings } from "@/lib/settings";
import { analyze } from "@/lib/engine";
import { asAppError, AppError } from "@/lib/errors";
import { acquire, localRequest, smallJson } from "@/lib/http";
import { parseRemoteUrl } from "@/lib/network";
import { getStore } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  try {
    localRequest(request, true);
    const input = await smallJson(request);
    if (typeof input.url !== "string") throw new AppError("URL", "L’URL est obligatoire.", 400);
    const url = parseRemoteUrl(input.url).href;
    const config=settings(input.settings ?? {});
    const release = acquire();
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    request.signal.addEventListener("abort", onAbort, { once: true });
    const encoder = new TextEncoder();
    let disconnected = false;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (type: string, data: unknown) => { if (!disconnected) { try { controller.enqueue(encoder.encode(JSON.stringify({ type, data }) + "\n")); } catch { disconnected = true; abort.abort(); } } };
        const timeout = setTimeout(() => abort.abort(), 180000);
        try {
          const result = await analyze(url, event => send("progress", event), { signal: abort.signal, settings: config });
          if (abort.signal.aborted) throw new AppError("TIMEOUT", "L’analyse a atteint sa limite de 180 secondes.");
          getStore().save(result);
          send("result", result);
        } catch (error) {
          const failure = abort.signal.aborted ? new AppError("TIMEOUT", "L’analyse a été interrompue ou a dépassé 180 secondes.") : asAppError(error);
          send("error", { code: failure.code, message: failure.message });
        } finally {
          clearTimeout(timeout); release();
          request.signal.removeEventListener("abort", onAbort);
          if (!disconnected) controller.close();
        }
      },
      cancel() { disconnected = true; abort.abort(); }
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (error) { const failure = asAppError(error); return Response.json({ code: failure.code, message: failure.message }, { status: failure.status }); }
}
