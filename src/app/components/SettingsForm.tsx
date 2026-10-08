"use client";
import { defaults, type Settings } from "@/lib/settings";
export default function SettingsForm({value,onChange}:{value:Settings;onChange:(s:Settings)=>void}) {
  const set=<K extends keyof Settings>(key:K,v:Settings[K])=>onChange({...value,[key]:v});
  return <div className="settings-grid">
    <label>Méthode<select value={value.method} onChange={e=>set("method",e.target.value as Settings["method"])}>{[["auto","Automatique"],["rss","RSS natif"],["html","HTML"],["browser","JavaScript"],["api","API JSON"]].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
    <label>Timeout par requête<select value={value.timeoutMs} onChange={e=>set("timeoutMs",+e.target.value)}>{[5,10,20,30].map(n=><option key={n} value={n*1000}>{n} s</option>)}</select></label>
    <label><input type="checkbox" checked={value.javascript} onChange={e=>set("javascript",e.target.checked)}/> JavaScript activé</label>
    <label><input type="checkbox" checked={value.pagination} onChange={e=>set("pagination",e.target.checked)}/> Pagination activée</label>
    <label>Nombre maximum de pages (1–20)<input type="number" min="1" max="20" list="pages" value={value.maxPages} onChange={e=>set("maxPages",+e.target.value)}/><datalist id="pages">{[1,2,3,5,10].map(n=><option key={n} value={n}/>)}</datalist></label>
    <label><input type="checkbox" checked={value.scroll} onChange={e=>set("scroll",e.target.checked)}/> Scroll infini / Charger plus</label>
    {([['maxScrolls','Scrolls maximum',1,30],['maxClicks','Clics maximum',0,30],['maxArticles','Articles maximum',1,500]] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="number" min={min} max={max} value={value[key]} onChange={e=>set(key,+e.target.value)}/></label>)}
    <label>Durée maximum du scroll (secondes)<input type="number" min="1" max="90" value={value.scrollDurationMs/1000} onChange={e=>set("scrollDurationMs",+e.target.value*1000)}/></label>
    <label>Actualisation<select value={value.refreshMinutes} onChange={e=>set("refreshMinutes",+e.target.value)}>{[0,15,30,60,180,360,720,1440].map(n=><option key={n} value={n}>{n===0?"Manuel":n<60?`${n} minutes`:`${n/60} heure(s)`}</option>)}</select></label>
    {([['userAgent','User-Agent'],['language','Langue'],['timezone','Timezone']] as const).map(([key,label])=><label key={key}>{label}<input value={value[key]} placeholder={defaults[key]} onChange={e=>set(key,e.target.value)}/></label>)}
    <label><input type="checkbox" checked={value.autoReanalyze} onChange={e=>set("autoReanalyze",e.target.checked)}/> Proposer une réanalyse si la règle casse</label>
  </div>;
}
