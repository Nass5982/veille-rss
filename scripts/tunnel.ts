import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { Store } from "../src/lib/store";
import { createFeedGateway } from "../src/lib/tunnel-gateway";
import { tunnelBinary } from "../src/lib/tunnel-process";
import { readTunnelState, writeTunnelState, tunnelLock, stopRequested, type TunnelProvider, type TunnelState } from "../src/lib/tunnel-state";
import { publicOrigin } from "../src/lib/public-url";
import { SafeFetcher, decodeText } from "../src/lib/network";
import { asAppError } from "../src/lib/errors";

async function main() {
  const selected = process.argv[process.argv.indexOf("--provider") + 1];
  const provider: TunnelProvider = selected === "ngrok" || selected === "named" ? selected : "cloudflare";
  const port = Number(process.env.TUNNEL_PORT ?? 4318);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000) throw new Error("TUNNEL_PORT doit être un port distinct de 3000, entre 1024 et 65535.");
  const runId = randomUUID();
  const unlock = tunnelLock(runId);
  const store = new Store();
  const state: TunnelState = { status: "starting", provider, message: "Démarrage de la passerelle RSS et du tunnel…", pid: process.pid, runId, port, updatedAt: new Date().toISOString() };
  let child: ChildProcess | undefined;
  let closed = false;
  let probing = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let lastProbe = 0;
  let networkHint = "";
  const gateway = createFeedGateway(store, () => state.publicUrl, runId);
  const save = () => { state.updatedAt = new Date().toISOString(); writeTunnelState(state); };
  const stop = (message = "Accès externe arrêté.", failed = false) => {
    if (closed) return;
    closed = true; clearInterval(interval);
    child?.kill(); gateway.closeAllConnections(); gateway.close();
    state.status = failed ? "error" : "stopped"; state.message = message; save();
    store.close(); unlock();
    process.exitCode = failed ? 1 : 0;
  };
  process.once("SIGINT", () => stop()); process.once("SIGTERM", () => stop());
  const probe = async () => {
    if (probing || !state.publicUrl || closed) return;
    probing = true; lastProbe = Date.now();
    try {
      const response = await new SafeFetcher(AbortSignal.timeout(12_000)).get(`${state.publicUrl}/api/public/health`);
      const health = JSON.parse(decodeText(response));
      if (response.status !== 200 || health.service !== "source-rss-gateway" || health.session !== runId) throw new Error("La réponse publique ne correspond pas à cette passerelle RSS.");
      state.status = "active"; state.verifiedAt = new Date().toISOString(); state.message = "Accès HTTPS public vérifié. Seuls les flux publiés sont exposés.";
    } catch (error) {
      state.status = "error"; state.message = networkHint || `Tunnel non accessible pour le moment : ${error instanceof SyntaxError ? "réponse HTML ou JSON inattendue" : error instanceof Error ? error.message : asAppError(error).message}`;
    } finally { probing = false; if (!closed) save(); }
  };
  const discover = (value: string) => {
    try {
      const url = publicOrigin(value);
      if (state.publicUrl === url) return;
      state.publicUrl = url; state.status = "starting"; state.message = "URL détectée ; vérification HTTPS en cours…"; save();
      console.log(`\nURL publique : ${url}\nFlux : ${url}/feed/{id}\nAdministration locale : http://localhost:3000\n`);
      void probe();
    } catch { /* Ignore log strings which are not public HTTPS origins. */ }
  };
  try {
    save();
    await new Promise<void>((resolve, reject) => { gateway.once("error", reject); gateway.listen(port, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${port}`;
    let args: string[];
    if (provider === "named") {
      if (!process.env.PUBLIC_BASE_URL || !process.env.TUNNEL_TOKEN) throw new Error("Mode durable : définir PUBLIC_BASE_URL et TUNNEL_TOKEN dans .env.local (voir README).");
      discover(process.env.PUBLIC_BASE_URL);
      args = ["tunnel", "--no-autoupdate", "run"];
    } else if (provider === "ngrok") {
      args = ["http", origin, "--log", "stdout", "--log-format", "json"];
      if (process.env.PUBLIC_BASE_URL) args.push("--url", publicOrigin(process.env.PUBLIC_BASE_URL));
    } else args = ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", origin];
    child = spawn(tunnelBinary(provider), args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    child.once("error", error => stop(`Impossible de lancer ${provider === "ngrok" ? "ngrok" : "cloudflared"} (${(error as NodeJS.ErrnoException).code ?? "erreur"}). Installez-le avec npm run tunnel:install, ou définissez son chemin dans .env.local.`, true));
    child.once("exit", code => { if (!closed) stop(`Le tunnel s’est arrêté (code ${code}). Consultez data/tunnel.log ou le terminal.`, true); });
    let buffer = "";
    const log = (chunk: Buffer) => {
      // Keep bounded local logs and never print credentials from our own environment.
      const text = process.env.TUNNEL_TOKEN ? chunk.toString().split(process.env.TUNNEL_TOKEN).join("[secret masqué]") : chunk.toString(); process.stdout.write(text);
      buffer = (buffer + text).slice(-32_000);
      if (/dial tcp [^\s]+:7844: i\/o timeout|HTTP\/2 connection is blocked|Allow outbound TCP on port 7844/.test(buffer)) {
        networkHint = "Cloudflare Tunnel ne peut pas joindre le port TCP sortant 7844. Autorisez ce trafic sur votre réseau ou utilisez ngrok. L’URL attribuée n’est pas encore accessible.";
        if (state.status !== "active") { state.status = "error"; state.message = networkHint; save(); }
      }
      if (provider === "cloudflare") {
        const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
        if (match) discover(match[0]);
      } else if (provider === "ngrok") {
        for (const line of buffer.split("\n")) {
          try { const entry = JSON.parse(line); if (entry.msg === "started tunnel" && typeof entry.url === "string" && entry.url.startsWith("https://")) discover(entry.url); } catch { /* Incomplete JSON log line. */ }
        }
      }
    };
    child.stdout?.on("data", log); child.stderr?.on("data", log);
    const started = Date.now();
    interval = setInterval(() => {
      if (stopRequested(runId)) { stop(); return; }
      if (!state.publicUrl && Date.now() - started > 90_000) { stop("Aucune URL publique reçue après 90 secondes. Vérifiez la connexion et l’installation du tunnel.", true); return; }
      save();
      if (Date.now() - lastProbe > 15_000) void probe();
    }, 3000);
    console.log(`Passerelle protégée : ${origin} (GET/HEAD /feed/* uniquement, plus /api/public/health). Ctrl+C pour arrêter.`);
  } catch (error) { stop(error instanceof Error ? error.message : "Démarrage du tunnel impossible.", true); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); const current = readTunnelState(); if (current?.publicUrl) console.error(`Tunnel existant : ${current.publicUrl}`); process.exitCode = 1; });
