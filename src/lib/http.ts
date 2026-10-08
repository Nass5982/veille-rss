import { getStore } from "./store";
import { AppError } from "./errors";
export function localRequest(request: Request, mutation = false): void {
  const host = request.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new AppError("HOST", "Cette application est réservée à un accès local.", 403);
  if (mutation) {
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== host || !/^https?:\/\//.test(origin)) throw new AppError("ORIGIN", "Requête refusée : origine locale attendue.", 403);
    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) throw new AppError("CONTENT_TYPE", "Le corps de la requête doit être en JSON.", 415);
  }
}
export async function smallJson(request: Request, limit = 8192): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INPUT", "Corps JSON absent.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > limit) throw new AppError("INPUT_SIZE", "Requête trop volumineuse.", 413);
      chunks.push(result.value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object expected");
    return parsed as Record<string, unknown>;
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError("INPUT", "Le JSON de la requête est invalide.", 400); }
  finally { reader.releaseLock(); }
}
const state = globalThis as typeof globalThis & { rssBusy?: boolean };
export function acquire(): () => void {
  if (state.rssBusy) throw new AppError("BUSY", "Une analyse est déjà en cours. Attendez sa fin.", 429);
  const unlock=getStore().lease();
  if(!unlock)throw new AppError("BUSY", "Une actualisation est déjà en cours.", 429);
  state.rssBusy = true;
  return () => { state.rssBusy = false; unlock(); };
}
