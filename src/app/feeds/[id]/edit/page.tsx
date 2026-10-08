import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import ExtractionEditor from "@/app/components/ExtractionEditor";
export const dynamic="force-dynamic";
export default async function Edit({params}:{params:Promise<{id:string}>}){const {id}=await params;const store=getStore();const feed=store.get(id,true);if(!feed)notFound();return <main><header className="topbar"><a href={`/feeds/${id}`}>← Retour au flux</a><a href="/feeds">Mes flux</a></header><ExtractionEditor feed={feed} initial={store.state(id).settings}/></main>;}
