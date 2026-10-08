"use client";
import {useEffect,useState} from "react";
import type {Analysis} from "@/lib/types";
export default function FavoriteArticles({feed}:{feed:Analysis}){
 const [favorites,setFavorites]=useState<string[]>([]),[message,setMessage]=useState("");
 useEffect(()=>{void fetch("/api/watch?favorites=1").then(r=>r.json()).then(d=>setFavorites((d.favorites??[]).map((i:{url:string})=>i.url))).catch(e=>setMessage(String(e)));},[]);
 async function toggle(url:string){try{const enabled=!favorites.includes(url);const r=await fetch("/api/watch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"articleFavorite",id:feed.id,url,enabled})});const d=await r.json();if(!r.ok)throw new Error(d.message);setFavorites(enabled?[...favorites,url]:favorites.filter(v=>v!==url));}catch(e){setMessage(String(e));}}
 return <section id="articles" className="panel"><h2>Articles ({feed.items.length})</h2><p>{message}</p>{feed.items.slice(0,50).map((item,i)=><article className="search-result" key={`${item.url}-${i}`}><button className="star-button" aria-label={`Favori ${item.title}`} onClick={()=>toggle(item.url)}>{favorites.includes(item.url)?"★":"☆"}</button><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><p>{item.sourceName} · {item.publishedAt?new Date(item.publishedAt).toLocaleString("fr-FR"):"Date non disponible"}</p><p>{item.description.slice(0,800)}</p></article>)}{feed.items.length>50&&<p>50 premiers articles affichés. Le RSS contient tous les articles retenus.</p>}</section>;
}
