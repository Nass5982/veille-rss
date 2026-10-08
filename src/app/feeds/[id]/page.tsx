import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import FeedManager from "@/app/components/FeedManager";
import FeedAccess from "@/app/components/FeedAccess";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function FeedDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const feed = getStore().get(id, true);
  if (!feed) notFound();
  return <main><header className="topbar"><a className="brand" href="/">source.</a><a href="/feeds">Mes flux</a></header><section className="intro"><p className="eyebrow">DÉTAIL DU FLUX</p><h1>{feed.title}</h1><p className="lead">{feed.items.length} articles · {feed.method.toUpperCase()} · <a href={feed.url} target="_blank" rel="noreferrer">Site source ↗</a></p></section><FeedAccess id={id}/><FeedManager id={id}/><footer>Le flux est enregistré dans SQLite. L’interface d’administration reste locale.</footer></main>;
}
