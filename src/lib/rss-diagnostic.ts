import { XMLParser, XMLValidator } from "fast-xml-parser";
import { isPublicUrl } from "./public-url";
import { SafeFetcher, decodeText, type Download, type Fetcher } from "./network";
import { asAppError } from "./errors";

export interface DiagnosticCheck { label: string; ok: boolean; value: string; }
export interface RSSDiagnostic {
  url: string; checkedAt: string; ok: boolean; publiclyAccessible: boolean;
  itemCount: number; checks: DiagnosticCheck[]; errors: string[]; warnings: string[]; scope: string;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : String(object(value)["#text"] ?? "");
function validDate(value: string): boolean {
  const match = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun), )?(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2})(?::(\d{2}))? (GMT|[+-]\d{4})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[3]);
  const day = Number(match[2]), year = Number(match[4]), hour = Number(match[5]), minute = Number(match[6]), second = Number(match[7] ?? 0);
  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60 && (!match[1] || ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()] === match[1]);
}
export function inspectRSS(download: Download, expectedItems?: number): RSSDiagnostic {
  const report: RSSDiagnostic = { url: download.url, checkedAt: new Date().toISOString(), ok: false, publiclyAccessible: false, itemCount: 0, checks: [], errors: [], warnings: [], scope: "GET HTTPS via l’adresse publique depuis cet ordinateur. Ce contrôle traverse le service du tunnel ; il ne simule pas le réseau propre à Inoreader." };
  const add = (label: string, ok: boolean, value: string, error: string) => { report.checks.push({ label, ok, value }); if (!ok) report.errors.push(error); };
  add("HTTP", download.status === 200, `${download.status}${download.status === 200 ? " OK" : ""}`, `Le serveur répond HTTP ${download.status}, au lieu de 200.`);
  const type = (download.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  add("Content-Type", type === "application/rss+xml", type || "Absent", `Content-Type reçu : ${type || "absent"}. application/rss+xml est attendu ; une page HTML intermédiaire peut bloquer le lecteur.`);
  const xml = decodeText(download);
  const validation = /<!DOCTYPE|<!ENTITY/i.test(xml) ? false : XMLValidator.validate(xml);
  add("XML", validation === true, validation === true ? "Valide" : "Invalide", "Le document n’est pas un XML valide, ou contient une déclaration DTD interdite.");
  let parsed: Record<string, unknown> = {};
  if (validation === true) {
    try { parsed = object(new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: true }).parse(xml)); } catch { report.errors.push("Le parseur XML ne peut pas lire le flux."); }
  }
  const rss = object(parsed.rss);
  const channel = object(rss.channel);
  add("RSS", rss["@_version"] === "2.0", rss["@_version"] === "2.0" ? "RSS 2.0" : "RSS 2.0 absent", "La racine rss version=2.0 est absente.");
  add("Channel", !!rss.channel && !Array.isArray(rss.channel), rss.channel ? "Présent" : "Absent", "Un unique élément channel est obligatoire.");
  add("Titre", !!text(channel.title).trim(), text(channel.title) || "Absent", "channel.title est vide.");
  add("Description", !!text(channel.description).trim(), text(channel.description) ? "Présente" : "Absente", "channel.description est vide.");
  const items = channel.item === undefined ? [] : Array.isArray(channel.item) ? channel.item : [channel.item];
  report.itemCount = items.length;
  add("Nombre d’articles", (expectedItems ?? 1) === 0 || items.length > 0, String(items.length), "Le flux ne contient aucun item alors que des articles sont attendus.");
  if (download.status === 200 && rss["@_version"] === "2.0" && !!rss.channel && expectedItems !== undefined && items.length !== expectedItems) report.warnings.push(`${items.length} articles publiés sur ${expectedItems} enregistrés ; les liens privés ou invalides sont exclus à la publication.`);
  const links = [text(channel.link), ...items.map(item => text(object(item).link))];
  const linksOK = links.every(isPublicUrl);
  add("URLs absolues", linksOK, linksOK ? "OK — liens publics" : "Échec", "channel.link ou un lien d’article est relatif, privé ou invalide.");
  const itemsAvailable = !!rss.channel && ((expectedItems ?? 1) === 0 || items.length > 0);
  const itemTitlesOK = itemsAvailable && items.every(item => text(object(item).title).trim());
  add("Titres des articles", itemTitlesOK, itemTitlesOK ? "OK" : "Échec", "Un article n’a pas de titre.");
  const dates = items.map(item => text(object(item).pubDate)).filter(Boolean);
  const dateOK = itemsAvailable && dates.every(validDate);
  add("Dates", dateOK, dateOK ? `OK (${dates.length} dates, ${items.length - dates.length} absentes)` : itemsAvailable ? "Invalides" : "Non vérifiables", itemsAvailable ? "Une date pubDate n’est pas une date RFC 822 valide." : "Les dates ne peuvent pas être vérifiées sans articles RSS.");
  if (dates.length < items.length) report.warnings.push("Les dates absentes sont autorisées par RSS 2.0 et ne sont pas inventées.");
  const guids = items.map(item => text(object(item).guid));
  const guidOK = itemsAvailable && guids.every(Boolean) && new Set(guids).size === guids.length && items.every(item => {
    const guid = object(object(item).guid);
    return guid["@_isPermaLink"] === "false" || isPublicUrl(text(object(item).guid));
  });
  add("GUID", guidOK, guidOK ? "OK — présents et uniques" : "Échec", "Les GUID sont absents, dupliqués ou déclarés comme permaliens sans URL publique.");
  const publicTransport = isPublicUrl(download.url) && new URL(download.url).protocol === "https:" && download.status === 200;
  report.publiclyAccessible = publicTransport && report.errors.length === 0;
  add("Accessible publiquement", report.publiclyAccessible, report.publiclyAccessible ? "Oui — GET HTTPS réussi" : "Non", "L’accès HTTPS public à un flux RSS conforme n’est pas confirmé.");
  report.ok = report.errors.length === 0;
  return report;
}
export async function diagnosePublicFeed(url: string, expectedItems?: number, network: Fetcher = new SafeFetcher()): Promise<RSSDiagnostic> {
  try {
    if (!isPublicUrl(url) || new URL(url).protocol !== "https:") throw new Error("L’URL du flux doit être HTTPS, absolue et publique. localhost et les réseaux privés ne sont pas accessibles depuis Inoreader.");
    return inspectRSS(await network.get(url), expectedItems);
  } catch (error) {
    const message = error instanceof Error && error.constructor === Error ? error.message : asAppError(error).message;
    return { url, checkedAt: new Date().toISOString(), ok: false, publiclyAccessible: false, itemCount: 0, checks: [{ label: "Accessible publiquement", ok: false, value: "Non" }], errors: [message], warnings: [], scope: "L’accès par l’URL HTTPS publique a échoué avant la validation RSS." };
  }
}
