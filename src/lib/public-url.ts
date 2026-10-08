import { parseRemoteUrl } from "./network";
import { AppError } from "./errors";

/** Syntactic check; actual outbound probes also validate DNS through SafeFetcher. */
export function isPublicUrl(value: string): boolean {
  try { parseRemoteUrl(value); return true; } catch { return false; }
}
export function publicOrigin(value: string): string {
  const url = parseRemoteUrl(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || new URL(value).hash)
    throw new AppError("PUBLIC_URL", "Une origine HTTPS publique sans chemin ni paramètres est attendue.", 400);
  return url.origin;
}
