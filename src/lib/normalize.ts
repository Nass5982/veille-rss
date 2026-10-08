import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { FeedItem, RawItem } from "./types";
import { safeHTML } from "./sanitize-html";
import { parseDate } from "./dates";
import { LIMITS } from "./network";

export function clean(value: unknown, max = 4000): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const $ = load(String(value).slice(0, 40_000));
  $("script,style,iframe,object,svg").remove();
  return $.root().text().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
export function absolute(value: unknown, base: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return;
  try {
    const url = new URL(value.trim(), base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
    url.hash = "";
    return url.href;
  } catch { return; }
}
export function canonical(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.href;
}
export const dateISO = parseDate;
export function normalize(raw: RawItem[], base: string, options: { maxItems?: number; now?: Date; timezone?: string } = {}): FeedItem[] {
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const entry of raw.slice(0, 2000)) {
    const title = clean(entry.title, 500);
    const url = absolute(entry.canonicalUrl, base) ?? absolute(entry.url, base);
    if (!title || !url) continue;
    const description = clean(entry.description);
    const publishedAt = dateISO(entry.publishedAt, options.now, options.timezone);
    const givenGuid = clean(entry.guid, 1000);
    const hash = createHash("sha256").update(`${title}|${publishedAt ?? ""}|${description}`).digest("hex");
    const keys = [`canonical:${canonical(url)}`, ...(givenGuid ? [`guid:${givenGuid}`] : []), `url:${url}`, ...(publishedAt ? [`title:${title.toLowerCase()}|${publishedAt}`] : []), `hash:${hash}`];
    if (keys.some(key => seen.has(key))) continue;
    keys.forEach(key => seen.add(key));
    items.push({ sourceId:entry.sourceId,sourceName:entry.sourceName,sourceUrl:entry.sourceUrl,detectedAt:entry.detectedAt,content:entry.content ?? clean(entry.description,20000),descriptionHtml:entry.descriptionHtml ?? (typeof entry.description === "string" && /<[a-z][\s\S]*>/i.test(entry.description) ? safeHTML(entry.description) : undefined), originalDate: entry.originalDate ?? (typeof entry.publishedAt === "string" ? entry.publishedAt : undefined), title, url: canonical(url), description, publishedAt, guid: givenGuid || canonical(url), author: clean(entry.author, 200) || undefined, image: absolute(entry.image, base), category: clean(entry.category, 200) || undefined });
    if (items.length >= (options.maxItems ?? LIMITS.items)) break;
  }
  return items;
}
