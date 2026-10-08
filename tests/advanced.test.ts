import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/lib/engine";
import { nextPage } from "../src/lib/pagination";
import { parseDate } from "../src/lib/dates";
import { settings } from "../src/lib/settings";
import { Store } from "../src/lib/store";
import { refresh,acceptProposal,schedulerTick } from "../src/lib/refresh";
import { manualHTML } from "../src/lib/extractors/ManualExtractor";
import { visualHTML,keepSnapshot,testSnapshot } from "../src/lib/editor";
import type { Fetcher } from "../src/lib/network";
const card=(n:number,cls="card")=>`<article class="${cls}"><h2><a href="/article/${n}?utm_source=test">Article intéressant ${n}</a></h2><time datetime="2026-09-27">27 septembre 2026</time><p>Description ${n}</p></article>`;
const cards=(start=1,end=3)=>Array.from({length:end-start+1},(_,i)=>card(start+i)).join("");
const rule={type:"css" as const,container:".card",fields:{title:{selector:"h2",mode:"text" as const},url:{selector:"a",mode:"url" as const,attribute:"href"}}};
function network(body:(u:URL)=>string):Fetcher{return {async get(url){return {url,status:200,headers:{"content-type":"text/html"},body:Buffer.from(body(new URL(url)))};}};}
test("Pagination : rel next, page, offset, start, chemins et boucle",async()=>{
 const base="https://fixture.news/news";
 for(const link of ['<a rel="next" href="?page=2">→</a>','<a href="?page=2">2</a>','<a href="?offset=20">Plus</a>','<a href="?start=20">Plus</a>','<a href="/page/2">2</a>','<a href="?page=2">Suivant</a>'])assert.ok(nextPage(link,base,new Set([base])));
 assert.equal(nextPage('<a rel="next" href="/news">Retour</a>',base,new Set([base])),undefined);
 const result=await analyze(base,()=>{},{settings:{method:"html",pagination:true,maxPages:3},network:network(u=>cards(u.search?3:1,u.search?5:3)+'<a rel="next" href="?page=2">Next</a>')});assert.equal(result.items.length,5);
});
test("Dates françaises, relatives, Unix et calendrier invalide",()=>{
 const now=new Date("2026-09-27T12:00:00Z");for(const date of ["27/09/2026","27 septembre 2026","Sep 27, 2026","2026-09-27"])assert.equal(parseDate(date,now,"UTC"),"2026-09-27T00:00:00.000Z");
 assert.equal(parseDate("Il y a 2 heures",now),"2026-09-27T10:00:00.000Z");assert.equal(parseDate("Il y a 30 minutes",now),"2026-09-27T11:30:00.000Z");assert.equal(parseDate("Hier",now),"2026-09-26T00:00:00.000Z");assert.equal(parseDate("Aujourd’hui",now),"2026-09-27T00:00:00.000Z");assert.equal(parseDate(1790503200),new Date(1790503200000).toISOString());assert.equal(parseDate("31/02/2026"),undefined);
});
test("CSS manuel, aperçu live et représentation sans ressources actives",()=>{
 assert.equal(manualHTML(cards(),"https://fixture.news",rule).items.length,3);assert.equal(manualHTML(cards().replaceAll('class="card"','class="changed"'),"https://fixture.news",rule).items.length,0);
 const token=keepSnapshot(cards(),"https://fixture.news");assert.equal(testSnapshot(token,rule,"UTC").matches.title.count,3);
 const safe=visualHTML('<script>alert(1)</script><iframe src="http://localhost"></iframe><article onclick="x()"><a href="javascript:x()">x</a><img src="http://localhost" onerror="x()"></article>');assert.doesNotMatch(safe,/<script|<iframe|onclick|onerror|src=|href=/);
 assert.throws(()=>settings({maxPages:100}));assert.throws(()=>settings({userAgent:"bad\r\nheader"}));
});
test("Actualisations : nouveaux, règle cassée, proposition et adoption explicite",async()=>{
 const store=new Store(":memory:");const initial=await analyze("https://fixture.news/news",()=>{},{settings:{method:"html",manual:rule},network:network(()=>cards(1,20))});store.save(initial);store.publish(initial.id);
 const first=await refresh(initial.id,{store,network:network(()=>cards(1,21))});assert.equal(first.newItems,1);assert.equal(store.get(initial.id)!.items.length,21);
 const broken=await refresh(initial.id,{store,network:network(()=>cards(1,21).replaceAll('class="card"','class="changed"'))});assert.equal(broken.errorType,"SELECTOR_BROKEN");assert.equal(store.get(initial.id)!.items.length,21);assert.ok(store.proposal(initial.id));assert.equal(store.state(initial.id).settings.manual?.container,".card");acceptProposal(initial.id,store);assert.equal(store.state(initial.id).settings.manual,undefined);assert.equal(store.history(initial.id)[0].status,"adopted");store.close();
});
test("Planificateur et verrou : une actualisation, calendrier persistant",async()=>{
 const store=new Store(":memory:");const feed=await analyze("https://fixture.news/news",()=>{},{settings:{method:"html"},network:network(()=>cards())});store.save(feed);store.publish(feed.id);const state=store.state(feed.id);store.setState(feed.id,{...state,settings:{...state.settings,refreshMinutes:15},nextRunAt:new Date(0).toISOString()});let called=0;const runner=async()=>{called++;return {} as Awaited<ReturnType<typeof refresh>>;};const release=store.lease()!;await schedulerTick(store,Date.now(),runner);assert.equal(called,0);release();await schedulerTick(store,Date.now(),runner);assert.equal(called,1);store.close();
});
for(const mode of ["load","scroll","xpath"] as const)test(`Playwright avancé : ${mode}`,{timeout:60000},async()=>{
 const initial=cards();const dynamic=mode==="load"?`<button onclick="document.querySelector('main').insertAdjacentHTML('beforeend',${JSON.stringify(cards(4,6)).replaceAll('"','&quot;')});this.remove()">Load more</button>`:mode==="scroll"?`<div style="height:1600px"></div><script>let done=false;addEventListener('scroll',()=>{if(!done){done=true;document.querySelector('main').insertAdjacentHTML('beforeend',${JSON.stringify(cards(4,6))})}})</script>`:"";
 const manual=mode==="xpath"?{type:"xpath" as const,container:"//article",fields:{title:{selector:".//h2",mode:"text" as const},url:{selector:".//a",mode:"url" as const,attribute:"href"}}}:undefined;
 const result=await analyze("https://fixture.news/news",()=>{},{settings:{method:"browser",scroll:mode!=="xpath",maxScrolls:3,maxClicks:2,scrollDurationMs:20000,manual},network:network(()=>`<html><body><main>${initial}</main>${dynamic}</body></html>`)});assert.equal(result.items.length,mode==="xpath"?3:6);
});
