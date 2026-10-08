import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { gunzip, inflate, brotliDecompress } from "node:zlib";
import ipaddr from "ipaddr.js";
import { AppError, asAppError } from "./errors";

export const LIMITS = { bytes: 3_000_000, redirects: 5, requestMs: 10_000, browserMs: 22_000, domBytes: 4_000_000, items: 200, totalMs: 60_000, requests: 90, totalBytes: 20_000_000 };
export interface Download { url: string; status: number; headers: Record<string, string>; body: Buffer; }
export interface FetchOptions { method?: "GET" | "POST"; body?: string; contentType?: string; }
export interface Fetcher { get(url: string, options?: FetchOptions): Promise<Download>; }
export function publicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === "unicast";
  } catch { return false; }
}
export function parseRemoteUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("URL", "Saisissez une URL HTTP ou HTTPS complète.", 400); }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || value.length > 4096)
    throw new AppError("URL", "Seules les URL HTTP/HTTPS sans identifiants sont acceptées.", 400);
  if (url.port && !["80", "443"].includes(url.port)) throw new AppError("SSRF", "Seuls les ports publics 80 et 443 sont autorisés.", 400);
  if (!host.includes(".") && !isIP(host) || /(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(host) || isIP(host) && !publicAddress(host))
    throw new AppError("SSRF", "Les adresses locales, privées et réservées sont interdites.", 400);
  url.hash = "";
  return url;
}
export async function resolvePublic(url: URL): Promise<{ address: string; family: number }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => !publicAddress(entry.address))) throw new AppError("SSRF", "Le domaine pointe vers une adresse privée ou réservée.", 400);
  return addresses[0];
}

/** Every hop is resolved, checked, then pinned to that exact IP at socket creation. */
export class SafeFetcher implements Fetcher {
  private requests = 0;
  private bytes = 0;
  private deadline: number;
  constructor(private signal?: AbortSignal, private config: { timeoutMs?: number; userAgent?: string; language?: string; totalMs?: number } = {}) { this.deadline = Date.now() + (config.totalMs ?? LIMITS.totalMs); }
  async get(input: string, options: FetchOptions = {}): Promise<Download> {
    let current = input;
    let opts = { ...options };
    try {
      for (let hop = 0; hop <= LIMITS.redirects; hop++) {
        if (this.signal?.aborted) throw new AppError("CANCELLED", "Analyse annulée.");
        if (++this.requests > LIMITS.requests || Date.now() >= this.deadline) throw new AppError("LIMIT", "Le budget de requêtes ou de temps de l’analyse est atteint.");
        const url = parseRemoteUrl(current);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const pinned = await Promise.race([
          resolvePublic(url),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError("TIMEOUT", "La résolution DNS a expiré.")), Math.min(this.config.timeoutMs ?? LIMITS.requestMs, this.deadline - Date.now())); })
        ]).finally(() => clearTimeout(timer));
        const result = await this.request(url, pinned, opts);
        if ([301, 302, 303, 307, 308].includes(result.status)) {
          if (!result.headers.location) throw new AppError("REDIRECT", "Redirection sans destination.");
          if (hop === LIMITS.redirects) throw new AppError("REDIRECT", "Le site effectue trop de redirections.");
          const next = new URL(result.headers.location, url);
          if (next.origin !== url.origin || result.status === 303 || [301, 302].includes(result.status)) opts = {};
          current = next.href;
          continue;
        }
        return result;
      }
      throw new AppError("REDIRECT", "Trop de redirections.");
    } catch (error) { throw asAppError(error); }
  }
  private request(url: URL, pinned: { address: string; family: number }, options: FetchOptions): Promise<Download> {
    return new Promise((resolve, reject) => {
      if ((options.body?.length ?? 0) > 64_000) return reject(new AppError("LIMIT", "Corps de requête trop volumineux."));
      const req = (url.protocol === "https:" ? https : http).request(url, {
        method: options.method ?? "GET", agent: false, signal: this.signal,
        // Preserve hostname/SNI/certificate validation while preventing DNS rebinding.
        lookup: (_hostname, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
        headers: { "user-agent": this.config.userAgent ?? "LocalRSS/0.1 (+local feed reader)", "accept-language": this.config.language ?? "fr-FR", "accept": "text/html,application/rss+xml,application/atom+xml,application/json,*/*;q=0.5", "accept-encoding": "identity", ...(options.contentType ? { "content-type": options.contentType } : {}) }
      }, res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          this.bytes += chunk.length;
          if (size > LIMITS.bytes || this.bytes > LIMITS.totalBytes) {
            const error = new AppError("SIZE", "La réponse dépasse la taille maximale autorisée.");
            reject(error);
            req.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          void (async () => {
            let body: Buffer = Buffer.concat(chunks);
            const encoding = res.headers["content-encoding"];
            const decompress: ((input: Buffer, options: { maxOutputLength: number }, callback: (error: Error | null, result: Buffer) => void) => void) | undefined = encoding === "gzip" ? gunzip : encoding === "deflate" ? inflate : encoding === "br" ? brotliDecompress : undefined;
            if (decompress) body = await new Promise<Buffer>((done, fail) => decompress(body, { maxOutputLength: LIMITS.bytes }, (error, result) => error ? fail(new AppError("SIZE", "Réponse compressée invalide ou trop volumineuse.")) : done(result)));
            if (body.length > LIMITS.bytes) throw new AppError("SIZE", "La réponse décompressée dépasse la limite.");
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
            resolve({ url: url.href, status: res.statusCode ?? 500, headers, body });
          })().catch(reject);
        });
      });
      const timeout = setTimeout(() => req.destroy(new AppError("TIMEOUT", "La requête au site a dépassé le délai configuré.")), Math.max(1, Math.min(this.config.timeoutMs ?? LIMITS.requestMs, this.deadline - Date.now())));
      req.on("close", () => clearTimeout(timeout));
      req.on("error", reject);
      req.end(options.body);
    });
  }
}
export function decodeText(download: Download): string {
  const charset = /charset=["']?([^;"'\s]+)/i.exec(download.headers["content-type"] ?? "")?.[1] ?? "utf-8";
  try { return new TextDecoder(charset).decode(download.body); } catch { return download.body.toString("utf8"); }
}
