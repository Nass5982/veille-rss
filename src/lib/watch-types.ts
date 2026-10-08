export const filterFields=["title","description","content","url","author","category","site","date","source","titleOrDescription"] as const;
export type FilterField=typeof filterFields[number];
export const operators=["contains","notContains","startsWith","endsWith","equals","notEquals","regex","after","before","lastDays"] as const;
export interface Criterion {type:"rule";field:FilterField;operator:typeof operators[number];value:string;caseSensitive:boolean}
export interface Group {type:"group";operator:"and"|"or"|"not";children:Filter[]}
export type Filter=Criterion|Group;
export interface Transformation {field:"title"|"description";operation:"template"|"replace"|"remove"|"trim"|"truncate"|"plain"|"safeHtml";value:string;replacement:string;regex:boolean;caseSensitive:boolean}
export interface WatchConfig {
  kind:"source"|"derived"|"aggregate";sourceIds:string[];filter:Group;transformations:Transformation[];
  sort:"newest"|"oldest"|"detected";dedup:{level:"url"|"title"|"similar"|"dated";threshold:number;dateHours:number;keep:"first"|"newest"|"both"|"priority";priorities:string[]};
  folder:string;tags:string[];favorite:boolean;updatedAt:string;
}
export const emptyGroup=():Group=>({type:"group",operator:"and",children:[]});
export const watchDefaults=():WatchConfig=>({kind:"source",sourceIds:[],filter:emptyGroup(),transformations:[],sort:"newest",dedup:{level:"url",threshold:85,dateHours:72,keep:"first",priorities:[]},folder:"",tags:[],favorite:false,updatedAt:""});
