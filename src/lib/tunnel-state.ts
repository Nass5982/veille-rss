import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";
export type TunnelProvider = "cloudflare" | "ngrok" | "named";
export interface TunnelState {
  status: "starting" | "active" | "error" | "stopped";
  provider: TunnelProvider; publicUrl?: string; message: string;
  updatedAt: string; verifiedAt?: string; pid: number; runId: string; port: number;
}
export const tunnelDirectory = () => join(process.cwd(), "data");
const statePath = () => join(tunnelDirectory(), "tunnel.json");
export function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
export function readTunnelState(): TunnelState | undefined {
  try {
    const state = JSON.parse(readFileSync(statePath(), "utf8")) as TunnelState;
    if (!state.runId || !state.updatedAt || !Number.isInteger(state.pid)) return;
    if (["starting", "active", "error"].includes(state.status) && Date.now() - Date.parse(state.updatedAt) > 20_000)
      return { ...state, status: "stopped", message: state.status === "error" ? state.message : "Le processus du tunnel est arrêté ou ne répond plus." };
    if (state.status === "active" && (!state.verifiedAt || Date.now() - Date.parse(state.verifiedAt) > 45_000))
      return { ...state, status: "error", message: "La vérification de l’accès HTTPS public a expiré." };
    return state;
  } catch { return; }
}
export function writeTunnelState(state: TunnelState): void {
  mkdirSync(tunnelDirectory(), { recursive: true });
  const temporary = `${statePath()}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(temporary, statePath());
}
export function tunnelLock(runId: string): () => void {
  mkdirSync(tunnelDirectory(), { recursive: true });
  const path = join(tunnelDirectory(), "tunnel.lock");
  if (existsSync(path)) {
    const previous = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
    if (alive(previous.pid)) throw new Error("Un tunnel est déjà lancé. Utilisez son URL ou arrêtez-le avant d’en ouvrir un autre.");
    unlinkSync(path);
  }
  const fd = openSync(path, "wx", 0o600);
  writeFileSync(fd, JSON.stringify({ pid: process.pid, runId })); closeSync(fd);
  return () => { try { const current = JSON.parse(readFileSync(path, "utf8")); if (current.runId === runId) unlinkSync(path); } catch { /* Already released. */ } };
}
export function requestTunnelStop(runId: string): void { writeFileSync(join(tunnelDirectory(), "tunnel-stop.json"), JSON.stringify({ runId }), { mode: 0o600 }); }
export function stopRequested(runId: string): boolean {
  try { return JSON.parse(readFileSync(join(tunnelDirectory(), "tunnel-stop.json"), "utf8")).runId === runId; } catch { return false; }
}
