import { load } from "cheerio";
import { absolute, canonical } from "./normalize";
export function nextPage(html: string, base: string, visited: Set<string>): string | undefined {
  const $ = load(html); const candidates: string[] = [];
  $("a[rel~=next],link[rel~=next]").each((_, el) => { candidates.push($(el).attr("href") ?? ""); });
  $("a[href]").each((_, el) => { const a=$(el); if (/^(suivant|next|page suivante|older posts|plus ancien)(?:\s|[›»→]|$)/i.test(`${a.text().trim()} ${a.attr("aria-label") ?? ""}`.trim())) candidates.push(a.attr("href") ?? ""); });
  const current = new URL(base);
  $("a[href]").each((_, el) => {
    const href = absolute($(el).attr("href"),base); if (!href) return;
    const u = new URL(href);
    for (const key of ["page","offset","start"]) { const n=u.searchParams.get(key); const old=current.searchParams.get(key); if(n && /^\d+$/.test(n) && +n > Number(old ?? (key === "page" ? 1 : 0))) candidates.push(href); }
    const path=/\/page\/(\d+)\/?$/.exec(u.pathname); const old=/\/page\/(\d+)\/?$/.exec(current.pathname); if(path && +path[1]===Number(old?.[1] ?? 1)+1) candidates.push(href);
  });
  return candidates.map(c=>absolute(c,base)).find((url): url is string => !!url && new URL(url).origin === current.origin && !visited.has(canonical(url)));
}
