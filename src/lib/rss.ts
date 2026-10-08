import type { Analysis } from "./types";
import { createHash } from "node:crypto";
import { isPublicUrl } from "./public-url";
import { AppError } from "./errors";
const escape = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function generateRSS(feed: Analysis, feedUrl: string): string {
  if (!isPublicUrl(feed.url)) throw new AppError("SOURCE_URL", "Le site source du flux doit être une URL publique absolue.");
  const items = feed.items.filter(item => isPublicUrl(item.url));
  if (feed.items.length && !items.length) throw new AppError("ITEM_URLS", "Aucun article ne possède de lien public absolu. Le flux ne peut pas être publié.");
  const tag = (name: string, value?: string) => value ? `<${name}>${escape(value)}</${name}>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel>
${tag("title", feed.title)}${tag("link", feed.url)}${tag("description", feed.description)}
<atom:link href="${escape(feedUrl)}" rel="self" type="application/rss+xml"/>
${tag("lastBuildDate", new Date(feed.createdAt).toUTCString())}
${items.map(item => {
    const guid = item.guid?.trim() || item.url || `urn:sha256:${createHash("sha256").update(`${item.title}|${item.publishedAt ?? ""}`).digest("hex")}`;
    const safeGuid = /^https?:/i.test(guid) && !isPublicUrl(guid) ? `urn:sha256:${createHash("sha256").update(guid).digest("hex")}` : guid;
    const date = item.publishedAt && Number.isFinite(Date.parse(item.publishedAt)) ? new Date(item.publishedAt).toUTCString() : undefined;
    return `<item>${tag("title", item.title)}${tag("link", item.url)}<guid isPermaLink="${isPublicUrl(safeGuid)}">${escape(safeGuid)}</guid>${tag("pubDate", date)}${tag("description", item.description || item.title)}${item.author ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.author) ? tag("author", item.author) : tag("dc:creator", item.author)) : ""}${tag("category", item.category)}${item.image && isPublicUrl(item.image) ? `<media:thumbnail url="${escape(item.image)}"/>` : ""}</item>`;
  }).join("\n")}
</channel></rss>`;
}
