import { load, type Cheerio } from "cheerio";
import type { Element, AnyNode } from "domhandler";
import type { Extraction, RawItem } from "../types";
import { clean, normalize } from "../normalize";

export class HTMLExtractor {
  extract(html: string, url: string, options: { maxItems?:number; timezone?:string } = {}): Extraction {
    const $ = load(html);
    const title = clean($("meta[property='og:title']").attr("content") ?? $("title").text(), 500);
    const description = clean($("meta[name=description]").attr("content") ?? $("meta[property='og:description']").attr("content"));
    const candidates: { raw: RawItem[]; confidence: number; detail: string }[] = [];
    const structured: RawItem[] = [];
    let visited = 0;
    const walk = (input: unknown, depth = 0): void => {
      if (!input || typeof input !== "object" || depth > 15 || ++visited > 10_000) return;
      if (Array.isArray(input)) { input.slice(0, 1000).forEach(v => walk(v, depth + 1)); return; }
      const node = input as Record<string, unknown>;
      const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : String(node["@type"] ?? "");
      if (/Article|NewsArticle|BlogPosting|Report|TechArticle/.test(type)) {
        const author = Array.isArray(node.author) ? node.author[0] : node.author;
        const image = Array.isArray(node.image) ? node.image[0] : node.image;
        const entity = node.mainEntityOfPage as Record<string, unknown> | string | undefined;
        structured.push({ title: node.headline ?? node.name, url: node.url ?? (typeof entity === "string" ? entity : entity?.["@id"]) ?? (type.includes("Article") ? url : undefined), description: node.description ?? node.articleBody, publishedAt: node.datePublished ?? node.dateModified, author: typeof author === "object" && author ? (author as Record<string, unknown>).name : author, image: typeof image === "object" && image ? (image as Record<string, unknown>).url : image, category: node.articleSection, guid: node["@id"] });
      }
      Object.values(node).forEach(v => walk(v, depth + 1));
    };
    $("script[type='application/ld+json']").slice(0, 40).each((_, node) => {
      try { walk(JSON.parse($(node).text())); } catch { /* Malformed metadata must not suppress usable cards. */ }
    });
    if (structured.length) candidates.push({ raw: structured, confidence: 0.94, detail: "Articles Schema.org / JSON-LD" });
    $("script,style,noscript,nav,body > header,footer,aside,form").remove();
    const fromElement = (element: Element): RawItem | undefined => {
      const card = $(element);
      const heading = card.find("h1,h2,h3,h4,[itemprop=headline]").first();
      let anchor: Cheerio<AnyNode> = heading.find("a[href]").first();
      if (!anchor.length) anchor = heading.closest<Element>("a[href]");
      if (!anchor.length) anchor = card.find("a[itemprop=url],a[rel=bookmark],a[href]").filter((_, a) => $(a).text().trim().length >= 8).first();
      const name = clean(heading.text() || anchor.attr("title") || anchor.text(), 500);
      if (name.length < 5 || !anchor.attr("href")) return;
      const time = card.find("time,[itemprop=datePublished],[datetime],.date,.published").first();
      const image = card.find("img").first();
      return { title: name, url: anchor.attr("href"), description: card.find("[itemprop=description],.excerpt,.summary,.description,p").first().html(), publishedAt: time.attr("datetime") ?? time.attr("content") ?? time.text(), author: card.find("[itemprop=author],[rel=author],.author").first().text(), image: image.attr("src") ?? image.attr("data-src"), category: card.find("[itemprop=articleSection],.category").first().text() };
    };
    const semantic: RawItem[] = [];
    $("article,[itemtype*='Article'],[itemtype*='BlogPosting']").slice(0, 500).each((_, node) => { const item = fromElement(node); if (item) semantic.push(item); });
    if (semantic.length) candidates.push({ raw: semantic, confidence: 0.86, detail: "Balises article / microdonnées Schema.org" });
    // Group actual siblings by tag and class signature: repeated cards need not be <article>.
    const groups = new Map<Element, Map<string, Element[]>>();
    $("h1,h2,h3,h4").slice(0, 1000).each((_, heading) => {
      let current = heading.parent;
      for (let depth = 0; depth < 3 && current && current.type === "tag"; depth++, current = current.parent) {
        if (!current.parent || current.parent.type !== "tag" || /^(body|html|main)$/.test(current.name)) continue;
        const siblings = groups.get(current.parent) ?? new Map<string, Element[]>();
        groups.set(current.parent, siblings);
        const signature = `${current.name}.${(current.attribs.class ?? "").split(/\s+/).filter(Boolean).sort().join(".")}`;
        const bucket = siblings.get(signature) ?? [];
        if (!bucket.includes(current)) bucket.push(current);
        siblings.set(signature, bucket);
      }
    });
    for (const siblings of groups.values()) for (const nodes of siblings.values()) {
      if (nodes.length < 2) continue;
      const raw = nodes.map(fromElement).filter((v): v is RawItem => !!v);
      if (raw.length < 2) continue;
      const richness = raw.filter(v => v.publishedAt || v.description || v.image).length / raw.length;
      candidates.push({ raw, confidence: Math.min(0.92, 0.58 + richness * 0.24 + Math.min(raw.length, 10) * 0.01), detail: `${raw.length} cartes répétées : ${nodes[0].name}${(nodes[0].attribs.class ?? "").split(/\s+/).filter(c=>/^[a-zA-Z_][\w-]*$/.test(c)).map(c=>"."+c).join("")}, score fondé sur titres, liens et métadonnées` });
    }
    if ($("meta[property='og:type']").attr("content") === "article") {
      candidates.push({ raw: [{ title, url: $("link[rel=canonical]").attr("href") ?? $("meta[property='og:url']").attr("content") ?? url, description, publishedAt: $("meta[property='article:published_time']").attr("content"), image: $("meta[property='og:image']").attr("content"), author: $("meta[name=author]").attr("content") }], confidence: 0.8, detail: "Article OpenGraph" });
    }
    const results = candidates.map(candidate => ({ ...candidate, items: normalize(candidate.raw, url, options) })).filter(c => c.items.length);
    results.sort((a, b) => b.confidence * Math.min(b.items.length, 20) - a.confidence * Math.min(a.items.length, 20));
    const best = results[0];
    return { method: "html", items: best?.items ?? [], confidence: best?.confidence ?? 0, title, description, sourceUrl: url, detail: best?.detail ?? "Aucune structure d’article fiable" };
  }
}
