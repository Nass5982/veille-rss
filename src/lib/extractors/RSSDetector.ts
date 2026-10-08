import { load } from "cheerio";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Extraction, RawItem } from "../types";
import { absolute, clean, normalize } from "../normalize";
import { decodeText, type Fetcher } from "../network";

type Node = Record<string, unknown>;
const obj = (v: unknown): Node => v && typeof v === "object" ? v as Node : {};
const list = (v: unknown): unknown[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const value = (v: unknown): string => typeof v === "string" || typeof v === "number" ? String(v) : String(obj(v)["#text"] ?? "");
export class RSSDetector {
  parse(xml: string, url: string): Extraction | undefined {
    if (!/<(?:rss|feed|rdf:RDF)[\s>]/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) return;
    try {
      // Decode standard XML escapes in links too; DTD/entity declarations were rejected above.
      const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, processEntities: true }).parse(xml) as Node;
      const atom = obj(parsed.feed);
      const rdf = obj(parsed["rdf:RDF"]);
      const channel = obj(obj(parsed.rss).channel ?? rdf.channel);
      const atomMode = !!parsed.feed;
      const root = atomMode ? atom : channel;
      const records = list(atomMode ? atom.entry : channel.item ?? rdf.item);
      const raw: RawItem[] = records.slice(0, 1000).map(entry => {
        const item = obj(entry);
        const links = list(item.link).map(obj);
        const link = atomMode ? links.find(l => !l["@_rel"] || l["@_rel"] === "alternate")?.["@_href"] : value(item.link);
        const media = obj(item["media:content"] ?? item["media:thumbnail"]);
        const enclosure = obj(item.enclosure);
        return { title: value(item.title), url: link, guid: value(item.guid ?? item.id), description: value(item.description ?? item.summary ?? item.content ?? item["content:encoded"]), publishedAt: value(item.pubDate ?? item.published ?? item.updated ?? item["dc:date"]), author: value(obj(item.author).name ?? item.author ?? item["dc:creator"]), category: value(list(item.category)[0]) || obj(list(item.category)[0])["@_term"], image: media["@_url"] ?? (String(enclosure["@_type"]).startsWith("image/") ? enclosure["@_url"] : undefined) };
      });
      const items = normalize(raw, url);
      if (!items.length) return;
      return { method: "rss", items, confidence: 1, title: clean(value(root.title)), description: clean(value(root.description ?? root.subtitle)), sourceUrl: url, detail: atomMode ? "Flux Atom natif" : "Flux RSS natif" };
    } catch { return; }
  }
  async extract(html: string, url: string, network: Fetcher): Promise<Extraction | undefined> {
    const direct = this.parse(html, url);
    if (direct) return direct;
    const $ = load(html);
    const candidates = new Set<string>();
    $("link[rel~=alternate]").each((_, element) => {
      if (/application\/(rss\+xml|atom\+xml)/i.test($(element).attr("type") ?? "")) {
        const candidate = absolute($(element).attr("href"), url);
        if (candidate) candidates.add(candidate);
      }
    });
    for (const path of ["/rss", "/feed", "/rss.xml", "/feed.xml", "/atom.xml"]) candidates.add(new URL(path, url).href);
    // Bounded batches; priority follows advertised feeds before conventional URLs.
    const urls = [...candidates].slice(0, 10);
    for (let i = 0; i < urls.length; i += 3) {
      const results = await Promise.all(urls.slice(i, i + 3).map(async candidate => {
        try {
          const response = await network.get(candidate);
          if (response.status >= 400) return;
          return this.parse(decodeText(response), response.url);
        } catch { return; }
      }));
      const found = results.find(Boolean);
      if (found) return found;
    }
  }
}
