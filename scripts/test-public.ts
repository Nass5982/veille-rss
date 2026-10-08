import assert from "node:assert/strict";
import { diagnosePublicFeed } from "../src/lib/rss-diagnostic";
import { readTunnelState } from "../src/lib/tunnel-state";
import { Store } from "../src/lib/store";
async function main() {
  const store = new Store();
  const latest = store.listPublished()[0]; store.close();
  const tunnel = readTunnelState();
  const url = process.argv[2] ?? (tunnel?.publicUrl && latest ? `${tunnel.publicUrl}/feed/${latest.id}` : undefined);
  if (!url) throw new Error("Indiquez une URL HTTPS publique : npm run test:public -- https://votre-tunnel/feed/id");
  const report = await diagnosePublicFeed(url);
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.ok, true, report.errors.join("\n"));
  console.log("Lecteur RSS simulé : GET HTTPS 200, Content-Type, XML, RSS 2.0, channel, titres, liens, dates et GUID vérifiés.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
