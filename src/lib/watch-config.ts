import { AppError } from "./errors";
import { filterFields,operators,watchDefaults,type WatchConfig,type Filter,type Group,type Transformation } from "./watch-types";
const fail=(message:string):never=>{throw new AppError("WATCH_CONFIG",message,400);};
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail("Objet de configuration attendu.");
const text=(v:unknown,max=500)=>typeof v==="string"&&v.length<=max?v:fail(`Texte requis (maximum ${max} caractères).`);
const choices=<T extends string>(v:unknown,list:readonly T[]):T=>typeof v==="string"&&list.includes(v as T)?v as T:fail("Option inconnue.");
const strings=(v:unknown,max:number)=>Array.isArray(v)&&v.length<=max?[...new Set(v.map(s=>text(s,100)))]:fail("Liste trop longue ou invalide.");
export function validateRegex(pattern:string,flags="i"):void {if(!pattern || pattern.length>200)fail("Regex requise, limitée à 200 caractères.");try{new RegExp(pattern,flags);}catch(e){fail(`Regex invalide : ${String(e)}`);}}
export function watchConfig(value:unknown):WatchConfig {
 const v=obj(value),base=watchDefaults();let nodes=0;
 const filter=(input:unknown,depth=0):Filter=>{if(++nodes>60||depth>5)fail("Limite : 60 critères/groupes et 5 niveaux.");const f=obj(input);
 if(f.type==="group"){if(!Array.isArray(f.children)||f.children.length>30)fail("Groupe invalide.");return {type:"group",operator:choices(f.operator,["and","or","not"]),children:(f.children as unknown[]).map(c=>filter(c,depth+1))};}
 if(f.type!=="rule")fail("Critère invalide.");const field=choices(f.field,filterFields),operator=choices(f.operator,operators),value=text(f.value,500);if(typeof f.caseSensitive!=="boolean")fail("Option de casse invalide.");
 if(operator==="regex")validateRegex(value);
 if(["after","before"].includes(operator)&&!Number.isFinite(Date.parse(value)))fail("Date du filtre invalide.");
 if(operator==="lastDays"&&(!/^\d+$/.test(value)||+value<1||+value>3650))fail("Période invalide (1–3650 jours).");
 if(["after","before","lastDays"].includes(operator)&&field!=="date")fail("Ce comparateur nécessite le champ Date.");return {type:"rule",field,operator,value,caseSensitive:f.caseSensitive as boolean};};
 const root=filter(v.filter??base.filter);if(root.type!=="group")fail("Un groupe racine est requis.");
 const transformations:Transformation[]=[];if(!Array.isArray(v.transformations??[])||(v.transformations as unknown[]??[]).length>30)fail("Maximum 30 transformations.");
 for(const value of (v.transformations??[]) as unknown[]){const t=obj(value);const item:Transformation={field:choices(t.field,["title","description"]),operation:choices(t.operation,["template","replace","remove","trim","truncate","plain","safeHtml"]),value:text(t.value,1000),replacement:text(t.replacement,1000),regex:t.regex===true,caseSensitive:t.caseSensitive===true};if(item.regex&&["replace","remove"].includes(item.operation))validateRegex(item.value);if(item.operation==="truncate"&&(!/^\d+$/.test(item.value)||+item.value<1||+item.value>20000))fail("Longueur invalide (1–20000).");transformations.push(item);}
 const d=obj(v.dedup??base.dedup);if(typeof d.threshold!=="number"||d.threshold<50||d.threshold>100||typeof d.dateHours!=="number"||d.dateHours<1||d.dateHours>8760)fail("Seuil de similarité ou proximité de date invalide.");
 const config:WatchConfig={kind:choices(v.kind??base.kind,["source","derived","aggregate"]),sourceIds:strings(v.sourceIds??[],30),filter:root as Group,transformations,sort:choices(v.sort??base.sort,["newest","oldest","detected"]),dedup:{level:choices(d.level,["url","title","similar","dated"]),threshold:d.threshold as number,dateHours:d.dateHours as number,keep:choices(d.keep,["first","newest","both","priority"]),priorities:strings(d.priorities,30)},folder:text(v.folder??"",200).trim(),tags:strings(v.tags??[],30).map(s=>s.trim()).filter(Boolean),favorite:v.favorite===true,updatedAt:new Date().toISOString()};
 if(config.kind==="source"&&config.sourceIds.length || config.kind==="derived"&&config.sourceIds.length!==1 || config.kind==="aggregate"&&!config.sourceIds.length)fail("Choisissez une source pour un flux dérivé, au moins une pour une agrégation.");return config;
}
