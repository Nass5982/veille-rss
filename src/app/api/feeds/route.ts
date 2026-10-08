import { AppError, asAppError } from "@/lib/errors";
import { localRequest, smallJson } from "@/lib/http";
import { getStore } from "@/lib/store";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    localRequest(request, true);
    const { id } = await smallJson(request);
    if (typeof id !== "string" || !getStore().publish(id)) throw new AppError("NOT_FOUND", "Analyse introuvable ou expirée. Lancez une nouvelle analyse.", 404);
    return Response.json({ path: `/feed/${id}` });
  } catch (error) { const failure = asAppError(error); return Response.json({ code: failure.code, message: failure.message }, { status: failure.status }); }
}
