import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {XMLParser} from "fast-xml-parser";
import {publicationConfig,exportPublication} from "../src/lib/publication/config";
import {emptyState,encryptState,decodeState,readState,writeState} from "../src/lib/publication/state";
import {buildPublication,writePublication,validateDirectory} from "../src/lib/publication/build";
import {remoteState} from "../src/lib/publication/github-state";
import {Store} from "../src/lib/store";
import {fixtureServer} from "./fixtures/server";
import type {Fetcher} from "../src/lib/network";
import {watchDefaults} from "../src/lib/watch-types";
const entry=(id:string,path="native",method="rss")=>({id,title:`Journal ${id}`,url:`https://fixture.news/${path}`,settings:{method},watch:watchDefaults(),publication:{slug:id,publish:true}});
const configuration=(feeds:unknown[])=>publicationConfig(JSON.stringify({format:"source-rss",version:1,feeds}));
const base="https://owner.github.io/rss";
let directory:string,origin:string;const server=fixtureServer();
before(async()=>{directory=await mkdtemp(join(tmpdir(),"rss-publication-"));await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const a=server.address();assert.ok(a&&typeof a!=="string");origin=`http://127.0.0.1:${a.port}`;});
after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});});
const network:Fetcher={async get(url,options){const u=new URL(url);assert.equal(u.origin,"https://fixture.news");const r=await fetch(origin+u.pathname+u.search,{method:options?.method,body:options?.body});return {url,status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())};}};
test("Export Actions conserve les IDs, dépendances privées de publication et règles",()=>{
 const store=new Store(":memory:");for(const id of ["source","theme"]){store.save({id,title:id,url:"https://fixture.news/native",description:"Test",items:[],method:"rss",confidence:1,detail:"Fixture",createdAt:new Date().toISOString()});store.publish(id);}store.setWatch("theme",{...watchDefaults(),kind:"derived",sourceIds:["source"]});const config=publicationConfig(exportPublication(store,["theme"]));assert.equal(config.feeds.length,2);assert.equal(config.feeds.find(f=>f.id==="source")!.publication.publish,false);assert.deepEqual(config.feeds.find(f=>f.id==="theme")!.watch.sourceIds,["source"]);store.close();
});
test("Configuration publique refuse secrets, URLs privées, slugs dangereux et cycles",()=>{
 for(const changed of [{...entry("a"),url:"http://localhost/x"},{...entry("a"),url:"https://example.com/?token=secret"},{...entry("a"),publication:{slug:"../../.env",publish:true}},{...entry("a"),cookies:"private"}])assert.throws(()=>configuration([changed]));assert.throws(()=>configuration([entry("a"),entry("a")]));assert.throws(()=>configuration([{...entry("a"),watch:{...watchDefaults(),kind:"derived",sourceIds:["a"]}}]));
});
test("État AES-GCM : confidentialité, intégrité, mauvaise clé et corruption sans reset",async()=>{
 const secret=randomBytes(32).toString("base64");const state=emptyState();state.updatedAt="marque-confidentielle";const text=encryptState(state,secret);assert.doesNotMatch(text,/marque-confidentielle/);assert.equal(decodeState(text,secret).updatedAt,state.updatedAt);assert.throws(()=>decodeState(text,randomBytes(32).toString("base64")),/mauvaise clé/);const altered=JSON.parse(text);altered.data=Buffer.from("corrompu").toString("base64");assert.throws(()=>decodeState(JSON.stringify(altered),secret));
 const path=join(directory,"state.enc");await writeState(path,state,secret);assert.equal((await readState(path,secret)).updatedAt,state.updatedAt);await writeFile(path,"broken");await assert.rejects(readState(path,secret,true),/corrompu/);await assert.rejects(readState(join(directory,"missing.enc"),secret,false));
});
test("Génération répétée : fichiers, agrégation, filtre, GUID/dates stables et échec conservateur",async()=>{
 const theme={...entry("psc"),watch:{...watchDefaults(),kind:"derived",sourceIds:["source"],filter:{type:"group",operator:"and",children:[{type:"rule",field:"title",operator:"contains",value:"numéro 1",caseSensitive:false}]},transformations:[{field:"title",operation:"template",value:"[PSC] {titre}",replacement:"",regex:false,caseSensitive:false}]}};
 const config=configuration([{...entry("source"),publication:{slug:"source",publish:false}},theme]);const first=await buildPublication(config,emptyState(),base,{network});assert.equal(first.report.feeds.length,1);assert.equal(first.report.feeds[0].items,11);const xml=first.files.get("feeds/psc.xml")!;const parsed=new XMLParser().parse(xml);assert.ok(parsed.rss.channel.item[0].title.startsWith("[PSC]"));
 const second=await buildPublication(config,decodeState(JSON.stringify(first.state)),base,{network});assert.equal(second.state.feeds.source.logs[0].newItems,0);assert.deepEqual(second.state.feeds.source.analysis.items.map(i=>[i.guid,i.publishedAt,i.detectedAt]),first.state.feeds.source.analysis.items.map(i=>[i.guid,i.publishedAt,i.detectedAt]));
 const archived=structuredClone(second.state);archived.feeds.source.analysis.items=[];
 const changed:Fetcher={async get(url,options){const response=await network.get(url,options);return {...response,body:Buffer.from(response.body.toString().replaceAll("<guid>","<guid>changed-"))};}};
 const returned=await buildPublication(config,archived,base,{network:changed});assert.equal(returned.state.feeds.source.analysis.items[0].guid,first.state.feeds.source.analysis.items[0].guid);
 const failed=await buildPublication(config,second.state,base,{network:{async get(){throw Object.assign(new Error("Timeout"),{code:"ETIMEDOUT"});}}});assert.equal(failed.report.refreshes[0].status,"error");assert.equal(failed.files.get("feeds/psc.xml"),second.files.get("feeds/psc.xml"));
 const out=join(directory,"site");await writePublication(out,failed.files);assert.equal(await validateDirectory(out,base),1);await writePublication(out,second.files);await writeFile(join(out,".env"),"secret");await assert.rejects(validateDirectory(out),/autorisés/);await assert.rejects(writePublication(out,second.files),/autorisés/);
 await assert.rejects(buildPublication(config,emptyState(),base,{network:{async get(){throw new Error("unavailable");}}}),/Première extraction/);
 const renamed=configuration([{...entry("source"),publication:{slug:"other",publish:false}},theme]);await assert.rejects(buildPublication(renamed,first.state,base,{network}),/slug/);
});
test("Autonome réel : HTML, JS, API et agrégation sans serveur Next.js",{timeout:90000},async()=>{
 const config=configuration([entry("html","static","html"),entry("js","js","browser"),entry("api","api-page","api"),{...entry("all"),watch:{...watchDefaults(),kind:"aggregate",sourceIds:["html","js","api"]}}]);const result=await buildPublication(config,emptyState(),base,{network});assert.equal(result.report.feeds.length,4);assert.equal(result.report.feeds.find(f=>f.id==="all")!.items,24);for(const id of ["html","js","api"])assert.equal(result.state.feeds[id].analysis.method,id==="js"?"browser":id);
});
test("Persistance GitHub : initialisation explicite, blob chiffré seul et détection des conflits",async()=>{
 const folder=join(directory,"remote");const secret=randomBytes(32).toString("base64");const calls:{path:string;body:Record<string,unknown>}[]=[];let ref:unknown;
 const request:typeof fetch=async(input,init)=>{const path=new URL(String(input)).pathname.replace('/repos/owner/rss','');const body=init?.body?JSON.parse(String(init.body)):{};calls.push({path,body});if(path==="/git/ref/heads/rss-state")return new Response(JSON.stringify(ref??{}),{status:ref?200:404});return Response.json({sha:"generated-sha"});};
 const options={repository:"owner/rss",token:"test-token",directory:folder,secret,request};await assert.rejects(remoteState("pull",options),/Première|première/);await remoteState("pull",{...options,initialize:true});await remoteState("push",options);const tree=calls.find(c=>c.path==="/git/trees")!;assert.deepEqual((tree.body.tree as {path:string}[]).map(x=>x.path),["state.enc"]);const blob=calls.find(c=>c.path==="/git/blobs")!;assert.equal(JSON.parse(Buffer.from(blob.body.content as string,"base64").toString()).format,"source-rss-state-aes-gcm");ref={object:{sha:"other-run"}};await assert.rejects(remoteState("push",options),/changé/);
});
