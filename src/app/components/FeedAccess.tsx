"use client";
import { useEffect, useState } from "react";
import type { TunnelState } from "@/lib/tunnel-state";
import type { RSSDiagnostic } from "@/lib/rss-diagnostic";

export default function FeedAccess({ id, localUrl: supplied }: { id: string; localUrl?: string }) {
  const [localUrl, setLocalUrl] = useState(supplied ?? "");
  const [tunnel, setTunnel] = useState<TunnelState>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [report, setReport] = useState<RSSDiagnostic>();
  const [copied, setCopied] = useState("");
  useEffect(() => {
    setLocalUrl(supplied ?? `${window.location.origin}/feed/${id}`);
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/tunnel", { cache: "no-store" });
        if (!response.ok) throw new Error("Impossible de lire l’état de l’accès externe.");
        const state = await response.json();
        if (!disposed) setTunnel(state);
      } catch { if (!disposed) setTunnel(undefined); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 4000);
    return () => { disposed = true; clearInterval(timer); };
  }, [id, supplied]);
  const active = tunnel?.status === "active";
  const publicUrl = tunnel?.publicUrl && tunnel.status !== "stopped" ? `${tunnel.publicUrl}/feed/${id}` : "";
  const recentReport = report?.url === publicUrl ? report : undefined;
  async function copy(url: string, kind: string) {
    try { await navigator.clipboard.writeText(url); setCopied(kind); }
    catch { setError("Copie automatique indisponible. Sélectionnez l’URL pour la copier manuellement."); }
  }
  async function control(action: "start" | "stop") {
    setPending(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/tunnel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, provider: "cloudflare" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setNotice(data.message);
    } catch (error) { setError(error instanceof Error ? error.message : "La commande de tunnel a échoué."); }
    finally { setPending(false); }
  }
  async function diagnose() {
    setTesting(true); setError(""); setReport(undefined);
    try {
      const response = await fetch(`/api/feeds/${id}/diagnostic`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setReport(data);
    } catch (error) { setError(error instanceof Error ? error.message : "Le diagnostic public a échoué."); }
    finally { setTesting(false); }
  }
  return <section className="access-panel" aria-label="Accès au flux RSS">
    <div className="section-heading"><h2>Partager ce flux</h2><span className={`access-badge ${active ? "active" : ""}`}>Accès externe : {active ? "Actif" : "Inactif"}</span></div>
    <div className="access-url"><label htmlFor={`local-${id}`}>URL locale <span>— uniquement sur cet ordinateur</span></label><div><input id={`local-${id}`} aria-label="URL locale" value={localUrl} readOnly onFocus={e => e.target.select()}/><button className="secondary" onClick={() => copy(localUrl, "local")}>{copied === "local" ? "URL locale copiée ✓" : "Copier l’URL locale"}</button><a className="button secondary" href={localUrl} target="_blank" rel="noreferrer">Voir le flux ↗</a></div></div>
    <div className="access-url"><label htmlFor={`public-${id}`}>URL publique <span>— Inoreader, Feedly, n8n, Make</span></label><div><input id={`public-${id}`} aria-label="URL publique" value={publicUrl} placeholder="Activez l’accès externe pour obtenir une URL HTTPS" readOnly onFocus={e => e.target.select()}/><button className="secondary" disabled={!active || !publicUrl} onClick={() => copy(publicUrl, "public")}>{copied === "public" ? "URL publique copiée ✓" : "Copier l’URL publique"}</button><button className="secondary" disabled={!publicUrl || testing} onClick={diagnose}>Tester l’URL publique</button></div></div>
    {!active && <p className="access-explanation">Ce flux est uniquement accessible sur votre ordinateur. Activez l’accès externe pour l’utiliser dans Inoreader ou Feedly.</p>}
    <p className="muted" aria-live="polite">{tunnel?.message ?? "Lecture de l’état du tunnel…"}</p>
    <div className="access-actions">{!active && tunnel?.status !== "starting" ? <button disabled={pending} onClick={() => control("start")}>Activer l’accès externe</button> : <button className="secondary" disabled={pending} onClick={() => control("stop")}>{tunnel?.status === "starting" ? "Annuler le démarrage" : "Désactiver l’accès externe"}</button>}<button className="secondary" disabled={!publicUrl || testing} onClick={diagnose}>{testing ? "Vérification HTTPS et RSS…" : "Tester la compatibilité RSS"}</button><a href={`/feeds/${id}`} className="text-button">Page de détail ↗</a></div>
    {tunnel?.status === "error" && <button className="secondary" disabled={pending} onClick={() => control("stop")}>Arrêter le tunnel en échec</button>}
    <p className="access-note">Seuls les flux déjà publiés et la route de contrôle sont exposés. Un tunnel temporaire change d’URL après redémarrage. Cet ordinateur et le tunnel doivent rester allumés. Les flux restent des instantanés.</p>
    {notice && <p className="muted" role="status">{notice}</p>}
    {error && <div className="error" role="alert">{error}</div>}
    {recentReport && <section className="diagnostic" aria-label="Diagnostic de compatibilité RSS"><div className="section-heading"><h3>Compatibilité RSS</h3><strong>{recentReport.ok && active ? "Vérifiée" : "À vérifier"}</strong></div><dl>{recentReport.checks.map(check => <div key={check.label}><dt>{check.label}</dt><dd className={check.ok ? "check-ok" : "check-fail"}>{check.value}</dd></div>)}</dl>{recentReport.errors.map(message => <p className="check-fail" key={message}>{message}</p>)}{recentReport.warnings.map(message => <p className="muted" key={message}>{message}</p>)}<p className="access-note">{recentReport.scope} Vérifié à {new Date(recentReport.checkedAt).toLocaleTimeString("fr-FR")}. {!active && "Attention : le tunnel est maintenant inactif ; ce résultat est historique."}</p></section>}
  </section>;
}
