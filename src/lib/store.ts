import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Analysis, ProgressEvent } from "./types";
import { defaults, settings, type Settings } from "./settings";
import { watchDefaults, type WatchConfig } from "./watch-types";
import { materialize } from "./watch";
export interface RefreshLog { id:string; feedId:string; startedAt:string; finishedAt?:string; status:string; method?:string; httpStatus?:number; itemsFound:number; newItems:number; durationMs?:number; errorType?:string; errorMessage?:string; events:(ProgressEvent & {at:string})[] }
export interface FeedState { settings:Settings; enabled:boolean; status:string; nextRunAt?:string; lastRunAt?:string; newItems:number; revision:number }
export interface Proposal { analysis:Analysis; settings:Settings; overlap:number; revision:number; previousCount:number; createdAt:string }
export class Store {
  private db: DatabaseSync;
  constructor(path = join(process.cwd(), "data", "rss.sqlite")) {
    if(path!==":memory:")mkdirSync(dirname(path),{recursive:true}); this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY,payload TEXT NOT NULL,published INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feed_state(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS refresh_log(id TEXT PRIMARY KEY,feed_id TEXT NOT NULL,started_at TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS refresh_feed ON refresh_log(feed_id,started_at);
      CREATE TABLE IF NOT EXISTS proposals(feed_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS seen_items(feed_id TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(feed_id,key));
      CREATE TABLE IF NOT EXISTS watch_config(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS article_favorites(key TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS engine_lease(id INTEGER PRIMARY KEY,token TEXT NOT NULL,expires INTEGER NOT NULL);`);
  }
  save(analysis:Analysis):void {
    this.db.prepare("DELETE FROM analyses WHERE published=0 AND created_at < ?").run(new Date(Date.now()-86400000).toISOString());
    this.db.prepare("INSERT INTO analyses(id,payload,created_at) VALUES(?,?,?)").run(analysis.id,JSON.stringify(analysis),analysis.createdAt);
  }
  get(id:string,publishedOnly=false):Analysis|undefined {const row=this.db.prepare(`SELECT payload FROM analyses WHERE id=?${publishedOnly?" AND published=1":""}`).get(id) as {payload:string}|undefined;return row?JSON.parse(row.payload):undefined;}
  publish(id:string):boolean {const ok=this.db.prepare("UPDATE analyses SET published=1 WHERE id=?").run(id).changes>0;if(ok){this.state(id);this.remember(id,this.get(id)!.items.map(i=>i.url));}return ok;}
  update(analysis:Analysis):void {this.db.prepare("UPDATE analyses SET payload=? WHERE id=?").run(JSON.stringify(analysis),analysis.id);}
  listPublished():Analysis[] {return (this.db.prepare("SELECT payload FROM analyses WHERE published=1 ORDER BY created_at DESC LIMIT 1000").all() as {payload:string}[]).map(r=>JSON.parse(r.payload));}
  state(id:string):FeedState {
    const row=this.db.prepare("SELECT payload FROM feed_state WHERE id=?").get(id) as {payload:string}|undefined;
    if(row)return JSON.parse(row.payload);
    const config=settings(this.get(id)?.settings ?? defaults);
    const state:FeedState={settings:config,enabled:true,status:"Actif",newItems:0,revision:0,nextRunAt:config.refreshMinutes?new Date(Date.now()+config.refreshMinutes*60000).toISOString():undefined};this.setState(id,state);return state;
  }
  setState(id:string,state:FeedState):void {this.db.prepare("INSERT OR REPLACE INTO feed_state VALUES(?,?)").run(id,JSON.stringify(state));}
  log(log:RefreshLog):void {this.db.prepare("INSERT OR REPLACE INTO refresh_log VALUES(?,?,?,?)").run(log.id,log.feedId,log.startedAt,JSON.stringify(log));this.db.prepare("DELETE FROM refresh_log WHERE feed_id=? AND id NOT IN (SELECT id FROM refresh_log WHERE feed_id=? ORDER BY started_at DESC LIMIT 200)").run(log.feedId,log.feedId);}
  history(id:string):RefreshLog[] {return(this.db.prepare("SELECT payload FROM refresh_log WHERE feed_id=? ORDER BY started_at DESC LIMIT 200").all(id) as {payload:string}[]).map(r=>JSON.parse(r.payload));}
  remember(id:string,keys:string[]):number {let added=0;const insert=this.db.prepare("INSERT OR IGNORE INTO seen_items VALUES(?,?)");for(const key of keys)added+=Number(insert.run(id,key).changes);return added;}
  seenKeys(id:string):string[] {return (this.db.prepare("SELECT key FROM seen_items WHERE feed_id=?").all(id) as {key:string}[]).map(row=>row.key);}
  proposal(id:string):Proposal|undefined {const row=this.db.prepare("SELECT payload FROM proposals WHERE feed_id=?").get(id) as {payload:string}|undefined;return row?JSON.parse(row.payload):undefined;}
  setProposal(id:string,value?:Proposal):void {if(value)this.db.prepare("INSERT OR REPLACE INTO proposals VALUES(?,?)").run(id,JSON.stringify(value));else this.db.prepare("DELETE FROM proposals WHERE feed_id=?").run(id);}
  remove(id:string):void {this.db.exec("BEGIN IMMEDIATE");try{for(const table of ["refresh_log","proposals","seen_items"])this.db.prepare(`DELETE FROM ${table} WHERE feed_id=?`).run(id);this.db.prepare("DELETE FROM feed_state WHERE id=?").run(id);this.db.prepare("DELETE FROM watch_config WHERE id=?").run(id);this.db.prepare("DELETE FROM analyses WHERE id=?").run(id);this.db.exec("COMMIT");}catch(e){this.db.exec("ROLLBACK");throw e;}}
  lease(now=Date.now()):(()=>void)|undefined {const token=randomUUID();const row=this.db.prepare("INSERT INTO engine_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE engine_lease.expires < ?").run(token,now+240000,now);if(!row.changes)return;return()=>{this.db.prepare("DELETE FROM engine_lease WHERE token=?").run(token);};}
  locked():boolean {return !!this.db.prepare("SELECT id FROM engine_lease WHERE expires>=?").get(Date.now());}
  watch(id:string):WatchConfig {const row=this.db.prepare("SELECT payload FROM watch_config WHERE id=?").get(id) as {payload:string}|undefined;return row?JSON.parse(row.payload):watchDefaults();}
  setWatch(id:string,value:WatchConfig):void {this.db.prepare("INSERT OR REPLACE INTO watch_config VALUES(?,?)").run(id,JSON.stringify(value));}
  output(id:string):Analysis|undefined {return materialize(this,id);}
  transaction<T>(work:()=>T):T {this.db.exec("BEGIN IMMEDIATE");try{const result=work();this.db.exec("COMMIT");return result;}catch(e){this.db.exec("ROLLBACK");throw e;}}
  favorites():import("./watch").WatchItem[] {return (this.db.prepare("SELECT payload FROM article_favorites ORDER BY rowid DESC").all() as {payload:string}[]).map(r=>JSON.parse(r.payload));}
  favorite(item:import("./watch").WatchItem,enabled:boolean):void {if(enabled)this.db.prepare("INSERT OR REPLACE INTO article_favorites VALUES(?,?)").run(item.url,JSON.stringify(item));else this.db.prepare("DELETE FROM article_favorites WHERE key=?").run(item.url);}
  close():void {this.db.close();}
}
const globalStore=globalThis as typeof globalThis & {rssStore?:Store;rssStoreVersion?:number};
const STORE_VERSION=3;
export function getStore(path?:string):Store {
  // Next development preserves globalThis across module reloads. Old class instances
  // must be reopened when their schema/API changes; persisted feeds are never reset.
  if(!globalStore.rssStore || globalStore.rssStoreVersion!==STORE_VERSION) {
    globalStore.rssStore?.close();globalStore.rssStore=new Store(path);globalStore.rssStoreVersion=STORE_VERSION;
  } else Object.setPrototypeOf(globalStore.rssStore,Store.prototype);
  return globalStore.rssStore;
}
