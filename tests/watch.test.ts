import {test} from "node:test";
import assert from "node:assert/strict";
import {matchFilter,transform,similarity,deduplicate,materialize} from "../src/lib/watch";
import {watchDefaults,type Criterion,type Transformation} from "../src/lib/watch-types";
import {watchConfig} from "../src/lib/watch-config";
import {Store} from "../src/lib/store";
import {exportOPML,parseOPML,exportJSON,parseJSON,importEntries} from "../src/lib/interchange";
import type {FeedItem} from "../src/lib/types";
import {generateRSS} from "../src/lib/rss";
const item:FeedItem={title:"PSC santé hospitalière - Journal",url:"https://source.fr/a",guid:"a",description:"Protection sociale complémentaire",publishedAt:"2026-09-27T10:00:00Z",sourceName:"Journal",sourceId:"a",detectedAt:"2026-09-27T11:00:00Z"};
const rule=(value:string,operator:Criterion["operator"]="contains",field:Criterion["field"]="title"):Criterion=>({type:"rule",field,operator,value,caseSensitive:false});
const change=(operation:Transformation["operation"],value="",replacement="",field:Transformation["field"]="title",regex=false):Transformation=>({field,operation,value,replacement,regex,caseSensitive:false});
test("Filtres AND / OR / NOT imbriqués et titre OU description",()=>{
 const filter={type:"group" as const,operator:"and" as const,children:[{type:"group" as const,operator:"or" as const,children:[rule("psc"),rule("mutuelle")]},{type:"group" as const,operator:"not" as const,children:[rule("territoriale")]}]};assert.deepEqual(matchFilter([item,{...item,title:"PSC territoriale"}],filter),[true,false]);assert.deepEqual(matchFilter([item],rule("complémentaire","contains","titleOrDescription")),[true]);
});
test("Opérateurs, Regex et respect de la casse",()=>{
 for(const [op,value] of [["startsWith","psc"],["endsWith","journal"],["notContains","auto"],["notEquals","PSC"],["regex","^PSC.*santé"]] as const)assert.equal(matchFilter([item],rule(value,op))[0],true);
 assert.equal(matchFilter([item],{...rule("psc"),caseSensitive:true})[0],false);assert.equal(matchFilter([item],rule(item.title,"equals"))[0],true);assert.throws(()=>watchConfig({...watchDefaults(),filter:{type:"group",operator:"and",children:[rule("[","regex")]}}));
 assert.throws(()=>matchFilter([{...item,title:"a".repeat(19000)+"!"}],rule("(a+)+$","regex")),/trop coûteuse/);
});
test("Dates : périodes, avant/après, dates absentes et futures",()=>{
 const now=Date.parse("2026-09-27T12:00:00Z");assert.deepEqual(matchFilter([item,{...item,publishedAt:undefined},{...item,publishedAt:"2027-01-01"}],rule("1","lastDays","date"),now),[true,false,false]);assert.equal(matchFilter([item],rule("2026-09-26","after","date"))[0],true);assert.equal(matchFilter([item],rule("2026-09-28","before","date"))[0],true);
});
test("Transformations : template source, suppression suffixe, regex et nettoyage HTML",()=>{
 const changed=transform([item],[change("remove"," - Journal"),change("template","[{source}] {titre}")]);assert.equal(changed[0].title,"[Journal] PSC santé hospitalière");assert.equal(changed[0].guid,item.guid);
 assert.equal(transform([item],[change("replace","PSC","Protection", "title",true)])[0].title,"Protection santé hospitalière - Journal");
 const dirty={...item,description:'<p onclick="x()">Test <strong>santé</strong><script>x()</script><img src="http://localhost"></p>'};const safe=transform([dirty],[change("safeHtml","","","description")])[0];assert.match(safe.description,/<strong>santé<\/strong>/);assert.doesNotMatch(safe.description,/script|onclick|localhost/);assert.equal(transform([dirty],[change("plain","","","description")])[0].description,"Test santé");assert.equal(transform([item],[change("truncate","3","","description")])[0].description.length,3);
});
test("Similarité et règles de conservation inter-sources",()=>{
 assert.ok(similarity("Réforme de la PSC hospitalière en 2027","PSC hospitalière : la réforme reportée à 2027")>.8);
 const other={...item,url:"https://other.fr/b",guid:"b",title:"psc SANTÉ hospitalière journal",sourceId:"b",publishedAt:"2026-09-28T10:00:00Z",detectedAt:"2026-09-28T11:00:00Z"};const config={...watchDefaults().dedup,level:"title" as const};assert.equal(deduplicate([item,other],config).items.length,1);assert.equal(deduplicate([item,other],{...config,keep:"newest"}).items[0].url,other.url);assert.equal(deduplicate([item,other],{...config,keep:"priority",priorities:["b"]}).items[0].url,other.url);assert.equal(deduplicate([item,other],{...config,keep:"both"}).items.length,2);assert.equal(deduplicate([item,other],{...config,level:"dated",dateHours:1}).items.length,2);
});
function seed(store:Store,id:string,items:FeedItem[]=[item]){store.save({id,title:`Journal ${id}`,url:`https://${id}.example.com`,description:"Test",items,createdAt:new Date().toISOString(),method:"html",confidence:.9,detail:"Fixture"});store.publish(id);}
test("Agrégation, source filtrée, flux dérivé dynamique, cycles et RSS vide valide",()=>{
 const store=new Store(":memory:");seed(store,"a");seed(store,"b",[{...item,title:"Auto",url:"https://b.example.com/car"}]);seed(store,"aggregate",[]);const config=watchConfig({...watchDefaults(),kind:"aggregate",sourceIds:["a","b"],filter:{type:"group",operator:"and",children:[rule("psc")]}});store.setWatch("aggregate",config);assert.equal(store.output("aggregate")!.items.length,1);assert.equal(store.output("aggregate")!.watchReport!.analyzed,2);
 store.setWatch("a",watchConfig({...watchDefaults(),filter:{type:"group",operator:"and",children:[rule("nothing")]}}));assert.equal(store.output("aggregate")!.items.length,0);assert.match(generateRSS(store.output("aggregate")!,"https://feeds.example.com/feed/aggregate"),/<channel>/);
 assert.throws(()=>materialize(store,"a",{...watchDefaults(),kind:"derived",sourceIds:["aggregate"]}),/circulaire/);store.close();
});
test("OPML dossiers imbriqués, entités XML, import atomique et export lecteur",()=>{
 const text='<?xml version="1.0"?><opml version="2.0"><body><outline text="Santé"><outline text="Hôpitaux"><outline text="Journal &amp; santé" xmlUrl="https://journal.fr/rss"/></outline></outline></body></opml>';
 const parsed=parseOPML(text);assert.equal(parsed[0].watch.folder,"Santé / Hôpitaux");assert.equal(parsed[0].title,"Journal & santé");const store=new Store(":memory:");const ids=importEntries(store,parsed);const exported=exportOPML(store,ids,"https://public.example.com");const round=parseOPML(exported);assert.equal(round[0].url,`https://public.example.com/feed/${ids[0]}`);assert.equal(round[0].watch.folder,"Santé / Hôpitaux");assert.throws(()=>parseOPML(text.replace("https://journal.fr/rss","http://127.0.0.1/rss")));assert.throws(()=>parseOPML('<!DOCTYPE opml [<!ENTITY a "x">]>'+text));store.close();
});
test("JSON complet : réglages, graphes remappés, dossiers/tags et rejet des cycles",()=>{
 const store=new Store(":memory:");seed(store,"a");seed(store,"derived",[]);store.setWatch("derived",watchConfig({...watchDefaults(),kind:"derived",sourceIds:["a"],tags:["PSC"],folder:"Santé",transformations:[change("template","[PSC] {titre}")]}));const parsed=parseJSON(exportJSON(store,["derived"]));assert.equal(parsed.length,2);const other=new Store(":memory:");const ids=importEntries(other,parsed);const derived=ids.find(id=>other.watch(id).kind==="derived")!;assert.equal(other.watch(derived).tags[0],"PSC");assert.notEqual(other.watch(derived).sourceIds[0],"a");assert.equal(other.listPublished().length,2);const bad=JSON.parse(exportJSON(store,["derived"]));bad.feeds[0].watch.sourceIds=["derived"];assert.throws(()=>parseJSON(JSON.stringify(bad)),/cycliques/);store.close();other.close();
});

test("Rechargement à chaud : ancien singleton remplacé sans méthodes manquantes",async()=>{
 const {getStore}=await import("../src/lib/store");const global=globalThis as typeof globalThis & {rssStore?:Store;rssStoreVersion?:number};const previous=global.rssStore,version=global.rssStoreVersion;
 try{global.rssStore=new Store(":memory:");global.rssStoreVersion=1;const fresh=getStore(":memory:");assert.equal(typeof fresh.output,"function");assert.equal(typeof fresh.state,"function");seed(fresh,"hot");assert.equal(fresh.output("hot")!.items.length,1);assert.match(generateRSS(fresh.output("hot")!,"http://localhost:3000/feed/hot"),/<rss version="2.0"/);}
 finally{global.rssStore?.close();global.rssStore=previous;global.rssStoreVersion=version;}
});
test("HTML conservé et GUID uniques quand deux sources reprennent un article",async()=>{
 const {normalize}=await import("../src/lib/normalize");const rich=normalize([{...item,description:'<p>Texte <strong>riche</strong></p>'}],item.url)[0];assert.match(rich.descriptionHtml!,/<strong>riche/);assert.equal(rich.description,"Texte riche");
 const store=new Store(":memory:");seed(store,"a",[item]);seed(store,"b",[{...item,sourceId:"b"}]);seed(store,"both",[]);store.setWatch("both",{...watchDefaults(),kind:"aggregate",sourceIds:["a","b"],dedup:{...watchDefaults().dedup,keep:"both"}});const both=store.output("both")!;assert.equal(both.items.length,2);assert.notEqual(both.items[0].guid,both.items[1].guid);store.close();
});
