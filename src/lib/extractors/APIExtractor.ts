import type { Extraction, RawItem } from "../types";
import { normalize } from "../normalize";

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }
function field(value: unknown): unknown { const record = object(value); return record.rendered ?? record.text ?? record.name ?? value; }
export class APIExtractor {
  extract(json: unknown, pageUrl: string, endpoint: string): Extraction | undefined {
    const candidates: Extraction[] = [];
    let count = 0;
    const walk = (value: unknown, depth: number): void => {
      if (!value || typeof value !== "object" || depth > 12 || ++count > 6000) return;
      if (Array.isArray(value)) {
        const raw: RawItem[] = value.slice(0, 500).map(entry => {
          const item = object(object(entry).node ?? entry);
          const author = Array.isArray(item.authors) ? item.authors[0] : item.author ?? item.creator;
          const image = item.image ?? item.thumbnail ?? item.image_url ?? item.cover;
          return { title: field(item.title ?? item.headline ?? item.name), url: item.url ?? item.link ?? item.permalink ?? item.canonical_url ?? item.web_url, canonicalUrl: item.canonical_url, description: field(item.description ?? item.excerpt ?? item.summary ?? item.content ?? item.body), publishedAt: item.publishedAt ?? item.published_at ?? item.published ?? item.pubDate ?? item.date ?? item.created_at ?? item.datePublished, author: field(author), image: object(image).url ?? object(image).src ?? image, category: field(item.category), guid: field(item.guid) };
        });
        const items = normalize(raw, pageUrl);
        const complete = items.filter(i => i.publishedAt && i.description).length;
        // A stable endpoint is a heuristic, never a guarantee or a stored credential.
        const stable = !/[?&](token|signature|expires|auth|key)=/i.test(endpoint);
        if (items.length >= 2 && items.length / Math.max(1, value.length) >= 0.5) candidates.push({ method: "api", items, confidence: Math.min(0.99, 0.72 + complete / items.length * 0.2 + (stable ? 0.06 : 0)), sourceUrl: endpoint, detail: `Liste JSON d’articles${stable ? ", URL sans jeton temporaire apparent" : ", URL potentiellement temporaire"}` });
        value.slice(0, 500).forEach(v => walk(v, depth + 1));
      } else Object.values(value).forEach(v => walk(v, depth + 1));
    };
    walk(json, 0);
    return candidates.sort((a, b) => b.items.length * b.confidence - a.items.length * a.confidence)[0];
  }
}
