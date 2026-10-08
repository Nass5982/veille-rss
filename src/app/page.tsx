"use client";
import { useState, useRef } from "react";
import type { Analysis, ProgressEvent } from "@/lib/types";
import SettingsForm from "./components/SettingsForm";
import { defaults, type Settings } from "@/lib/settings";
import FeedAccess from "./components/FeedAccess";

export default function Home() {
  const [config,setConfig] = useState<Settings>(defaults);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [analysis, setAnalysis] = useState<Analysis>();
  const [error, setError] = useState("");
  const [feed, setFeed] = useState("");
  const abort = useRef<AbortController | null>(null);
  async function run(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setEvents([]); setAnalysis(undefined); setError(""); setFeed("");
    const controller = new AbortController(); abort.current = controller;
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, settings: config }), signal: controller.signal });
      if (!response.ok) { const data = await response.json(); throw new Error(`${data.code} — ${data.message}`); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Le navigateur ne peut pas lire la progression de l’analyse.");
      const decoder = new TextDecoder(); let buffer = ""; let completed = false;
      for (;;) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === "progress") setEvents(previous => [...previous.filter(e => e.step !== message.data.step), message.data]);
          if (message.type === "result") { setAnalysis(message.data); completed = true; }
          if (message.type === "error") throw new Error(`${message.data.code} — ${message.data.message}`);
        }
        if (chunk.done) break;
      }
      if (!completed) throw new Error("La connexion a été interrompue avant la fin de l’analyse. Réessayez.");
    } catch (err) { setError(err instanceof Error && err.name === "AbortError" ? "Analyse annulée." : err instanceof Error ? err.message : "Impossible de joindre le serveur local. Vérifiez qu’il est démarré."); }
    finally { setBusy(false); abort.current = null; }
  }
  async function publish() {
    setPublishing(true); setError("");
    try {
      const response = await fetch("/api/feeds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: analysis?.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setFeed(new URL(data.path, window.location.origin).href);
      setEvents(previous => [...previous.filter(e => e.step !== "feed"), { step: "feed", status: "success", message: "Flux RSS 2.0 généré et enregistré" }]);
    } catch (err) { setError(err instanceof Error ? err.message : "Impossible d’enregistrer le flux dans SQLite."); }
    finally { setPublishing(false); }
  }
  return <main>
    <header className="topbar"><a className="brand" href="/"><span className="brand-icon">◔</span> source<span className="brand-dot">.</span></a><a href="/feeds">Mes flux</a><span className="local"><i/> Moteur local <span className="version">v0.3</span></span></header>
    <section className="intro"><p className="eyebrow">LE WEB, À VOTRE RYTHME</p><h1>Une page web.<br/>Votre prochain <span>flux RSS.</span></h1><p className="lead">Retrouvez les articles d’un site dans votre lecteur préféré.<br className="desktop"/> Collez une URL publique, Source s’occupe de l’extraction.</p></section>
    <section className="workspace">
      <div className="input-panel"><form onSubmit={run}><label htmlFor="url">Quelle page souhaitez-vous suivre ?</label><div className="url-row"><span aria-hidden="true" className="link-icon">↗</span><input id="url" type="url" required placeholder="https://exemple.fr/actualites" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} autoComplete="url"/><button type="submit" disabled={busy}>{busy ? "Analyse en cours…" : "Analyser"}<span aria-hidden="true">→</span></button></div><p className="hint">Sites publics uniquement · Traitement sur votre ordinateur</p><details><summary>Réglages avancés</summary><SettingsForm value={config} onChange={setConfig}/><a href="/correction">Corriger l’extraction avec des sélecteurs</a></details></form></div>
      {error && <div className="error" role="alert"><strong>L’analyse demande votre attention</strong><p>{error}</p><a href="/correction">Corriger l’extraction</a></div>}
      {(events.length > 0 || busy) && <section className="progress-panel" aria-label="Progression de l’analyse"><div className="section-heading"><h2>{busy ? "Lecture de la source" : analysis ? "Analyse terminée" : "Diagnostic"}</h2>{busy && <button className="text-button" onClick={() => abort.current?.abort()}>Annuler</button>}</div><ul className="progress" aria-live="polite">{events.map(event => <li key={event.step} className={event.status}><span aria-hidden="true" className={event.status === "running" && busy ? "spinner" : "status-icon"}>{event.status === "running" && busy ? "" : event.status === "warning" ? "–" : event.status === "error" ? "!" : "✓"}</span>{event.message}</li>)}</ul></section>}
      {analysis && <section className="results"><div className="section-heading results-heading"><div><p className="eyebrow">VOTRE SÉLECTION</p><h2>{analysis.items.length} articles détectés</h2><p className="muted">{analysis.title} · {analysis.method.toUpperCase()} · confiance {Math.round(analysis.confidence * 100)} %</p></div>{!feed && <button onClick={publish} disabled={publishing}>{publishing ? "Création…" : "Créer le flux RSS"}<span aria-hidden="true">＋</span></button>}</div>
        {feed && <><FeedAccess id={analysis.id} localUrl={feed}/><a href={`/feeds/${analysis.id}`}>Gérer ce flux · Actualisations · Historique</a></>}
        <div className="preview-caption"><span>Aperçu des {Math.min(10, analysis.items.length)} premiers articles</span><span>{analysis.detail}</span></div><div className="article-list">{analysis.items.slice(0, 10).map((item, index) => <article className="article-card" key={`${item.guid}-${index}`}><span className="article-number">{String(index + 1).padStart(2, "0")}</span><div className="article-body"><div className="article-meta">{item.publishedAt ? <time dateTime={item.publishedAt}>{new Date(item.publishedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</time> : <span>Date non disponible</span>}{item.author && <span>Par {item.author}</span>}{item.category && <span>{item.category}</span>}</div><h3><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} <span aria-hidden="true">↗</span></a></h3><p>{item.description || "Aucune description fournie par la source."}</p><a className="article-url" href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a></div>{item.image && <img className="article-image" src={`/api/images/${analysis.id}/${index}`} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = "none"; }}/>}</article>)}</div><p className="snapshot-note">Les actualisations se configurent dans la page du flux. Le serveur local doit rester démarré.</p></section>}
      {!analysis && !busy && !events.length && <section className="how"><div><span>01</span><h2>Détecter</h2><p>Le flux RSS natif est recherché en priorité.</p></div><div><span>02</span><h2>Extraire</h2><p>HTML, données structurées, puis JavaScript si nécessaire.</p></div><div><span>03</span><h2>Rassembler</h2><p>Des articles nettoyés et dédoublonnés, dans un flux standard.</p></div></section>}
    </section><footer><span>Source · Un peu moins de bruit, un peu plus de lecture.</span><span>RSS 2.0 / Atom / HTML / JSON</span></footer>
  </main>;
}
