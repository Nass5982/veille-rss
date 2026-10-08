import {getStore} from "@/lib/store";
import WatchEditor from "@/app/components/WatchEditor";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{source?:string}>}){const {source}=await searchParams;const store=getStore();const feeds=store.listPublished();const feed=feeds.find(f=>f.id===source)??feeds[0];return <main><header className="topbar"><a href="/feeds">← Mes flux</a></header>{feed?<WatchEditor feed={feed} creating sources={feeds.map(({id,title})=>({id,title}))}/>:<p>Créez ou importez d’abord une source depuis <a href="/">l’analyse automatique</a> ou <a href="/feeds">le tableau de bord</a>.</p>}</main>;}
