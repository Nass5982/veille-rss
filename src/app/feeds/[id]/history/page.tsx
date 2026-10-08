import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { History } from "@/app/components/FeedManager";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;const store=getStore();if(!store.get(id,true))notFound();return <main><header className="topbar"><a href={`/feeds/${id}`}>← Retour au flux</a></header><History logs={store.history(id)}/></main>;}
