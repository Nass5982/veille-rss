import { AppError } from "./errors";
export const fields = ["title", "url", "publishedAt", "description", "image", "author", "category"] as const;
export type Field = typeof fields[number];
export interface FieldRule { selector: string; mode: "text" | "attribute" | "html" | "url"; attribute?: string }
export interface ManualRule { type: "css" | "xpath"; container: string; fields: Partial<Record<Field, FieldRule>> }
export interface Settings {
  method: "auto" | "rss" | "html" | "browser" | "api";
  javascript: boolean; pagination: boolean; maxPages: number;
  scroll: boolean; maxScrolls: number; maxClicks: number; scrollDurationMs: number;
  maxArticles: number; timeoutMs: number; userAgent: string; language: string; timezone: string;
  refreshMinutes: number; autoReanalyze: boolean; manual?: ManualRule;
}
export const defaults: Settings = { method: "auto", javascript: true, pagination: false, maxPages: 1, scroll: false, maxScrolls: 10, maxClicks: 10, scrollDurationMs: 30000, maxArticles: 200, timeoutMs: 10000, userAgent: "LocalRSS/0.2 (+local feed reader)", language: "fr-FR", timezone: "Europe/Paris", refreshMinutes: 0, autoReanalyze: true };
export function settings(value: unknown = {}): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("SETTINGS", "Paramètres invalides.", 400);
  const v = value as Record<string, unknown>;
  const fail = (key: string): never => { throw new AppError("SETTINGS", `Paramètre invalide : ${key}.`, 400); };
  const number = (key: keyof Settings, min: number, max: number) => { const n = v[key] ?? defaults[key]; return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : fail(key); };
  const bool = (key: keyof Settings) => { const n = v[key] ?? defaults[key]; return typeof n === "boolean" ? n : fail(key); };
  const str = (key: keyof Settings, max: number) => { const n = v[key] ?? defaults[key]; return typeof n === "string" && n.length > 0 && n.length <= max && !/[\r\n\0]/.test(n) ? n : fail(key); };
  const method = str("method", 20) as Settings["method"];
  if (!["auto", "rss", "html", "browser", "api"].includes(method)) fail("method");
  const result: Settings = { method, javascript: bool("javascript"), pagination: bool("pagination"), maxPages: number("maxPages", 1, 20), scroll: bool("scroll"), maxScrolls: number("maxScrolls", 1, 30), maxClicks: number("maxClicks", 0, 30), scrollDurationMs: number("scrollDurationMs", 1000, 90000), maxArticles: number("maxArticles", 1, 500), timeoutMs: number("timeoutMs", 5000, 30000), userAgent: str("userAgent", 200), language: str("language", 40), timezone: str("timezone", 80), refreshMinutes: number("refreshMinutes", 0, 1440), autoReanalyze: bool("autoReanalyze") };
  if (![0,15,30,60,180,360,720,1440].includes(result.refreshMinutes)) fail("refreshMinutes");
  try { new Intl.DateTimeFormat(result.language, { timeZone: result.timezone }); } catch { fail("langue / timezone"); }
  if (!result.javascript && (method === "browser" || result.scroll)) fail("JavaScript désactivé");
  if (v.manual) {
    const rule = v.manual as ManualRule;
    if (!["css","xpath"].includes(rule.type) || typeof rule.container !== "string" || !rule.container.trim() || rule.container.length > 500 || !rule.fields) fail("conteneur");
    const parsed: ManualRule = { type: rule.type, container: rule.container, fields: {} };
    for (const key of fields) {
      const f = rule.fields[key]; if (!f) continue;
      if (typeof f.selector !== "string" || f.selector.length > 500 || !["text","attribute","html","url"].includes(f.mode) || (f.attribute !== undefined && !/^[\w:-]{1,80}$/.test(f.attribute))) fail(key);
      parsed.fields[key] = { selector: f.selector, mode: f.mode, attribute: f.attribute };
    }
    result.manual = parsed;
  }
  return result;
}
