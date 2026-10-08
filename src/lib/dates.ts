/** Relative dates use the run clock; calendar dates use the configured site timezone. */
export function parseDate(value: unknown, now = new Date(), timezone = "UTC"): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return;
  if (typeof value === "number" || /^\d{10}(?:\d{3})?$/.test(value.trim())) {
    const n = Number(value); const d = new Date(n < 1e12 ? n * 1000 : n); return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  }
  const text = value.trim().toLowerCase().replace(/’/g, "'"); if (!text) return;
  const relative = /^(?:il y a|ago)\s+(\d+)\s+(minute|heure|jour|hour|day|min)/.exec(text);
  if (relative) return new Date(now.getTime() - Number(relative[1]) * (/heure|hour/.test(relative[2]) ? 3600000 : /jour|day/.test(relative[2]) ? 86400000 : 60000)).toISOString();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now);
  const current = (type: string) => Number(parts.find(p => p.type === type)?.value);
  let y: number | undefined, m = 0, d = 0;
  if (/^(aujourd'hui|hier|today|yesterday)$/.test(text)) { const day = new Date(Date.UTC(current("year"), current("month") - 1, current("day") - (/hier|yesterday/.test(text) ? 1 : 0))); y = day.getUTCFullYear(); m = day.getUTCMonth() + 1; d = day.getUTCDate(); }
  const numeric = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const french = /^(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})$/.exec(text);
  if (numeric) { d=+numeric[1]; m=+numeric[2]; y=+numeric[3]; }
  if (iso) { y=+iso[1]; m=+iso[2]; d=+iso[3]; }
  if (french) { d=+french[1]; m="janvier février mars avril mai juin juillet août septembre octobre novembre décembre".split(" ").indexOf(french[2])+1; y=+french[3]; }
  const english=/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?) (\d{1,2}),? (\d{4})$/.exec(text);
  if(english){y=+english[3];d=+english[2];m="jan feb mar apr may jun jul aug sep oct nov dec".split(" ").indexOf(english[1].slice(0,3))+1;}
  if (y !== undefined) {
    const utc = Date.UTC(y,m-1,d); const date = new Date(utc);
    if (date.getUTCFullYear()!==y || date.getUTCMonth()!==m-1 || date.getUTCDate()!==d) return;
    let time=utc;
    for(let i=0;i<3;i++) { const p=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(time); const n=(key:string)=>Number(p.find(x=>x.type===key)?.value); time += utc-Date.UTC(n("year"),n("month")-1,n("day"),n("hour"),n("minute"),n("second")); }
    return new Date(time).toISOString();
  }
  const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}
