import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { readTunnelState, tunnelDirectory, type TunnelProvider } from "./tunnel-state";

export function tunnelBinary(provider: TunnelProvider): string {
  const name = provider === "ngrok" ? "ngrok" : "cloudflared";
  const configured = process.env[name === "ngrok" ? "NGROK_PATH" : "CLOUDFLARED_PATH"];
  const portable = join(process.cwd(), ".tools", name + (process.platform === "win32" ? ".exe" : ""));
  return configured || (existsSync(portable) ? portable : name);
}
export async function startTunnelProcess(provider: TunnelProvider): Promise<boolean> {
  const state = readTunnelState();
  if (state && state.status !== "stopped" && Date.now() - Date.parse(state.updatedAt) < 20_000) return false;
  mkdirSync(tunnelDirectory(), { recursive: true });
  const fd = openSync(join(tunnelDirectory(), "tunnel.log"), "w", 0o600);
  try {
    const child = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", "tunnel.ts"), "--provider", provider], {
      cwd: process.cwd(), detached: true, windowsHide: true, shell: false, stdio: ["ignore", fd, fd], env: process.env
    });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    return true;
  } finally { closeSync(fd); }
}
