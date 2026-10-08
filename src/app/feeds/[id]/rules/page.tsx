import {notFound} from "next/navigation";
import {getStore} from "@/lib/store";
import WatchEditor from "@/app/components/WatchEditor";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;const store=getStore();const feed=store.get(id,true);if(!feed)notFound();return <main><header className="topbar"><a href={`/feeds/${id}`}>← Retour au flux</a><a href="/feeds">Tableau de bord</a></header><WatchEditor feed={feed} initial={store.watch(id)} sources={store.listPublished().map(({id,title})=>({id,title}))}/></main>;}
