import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
export const articles = Array.from({ length: 24 }, (_, i) => ({ title: `Article de test numéro ${i + 1}`, url: `/articles/${i + 1}`, date: `2026-09-${String(24 - i).padStart(2, "0")}T10:00:00Z`, description: `Description de l’article ${i + 1} avec des données vérifiables.`, author: "Camille Martin", image: "/cover.png" }));
const cards = articles.map(a => `<article><h2><a href="${a.url}">${a.title}</a></h2><time datetime="${a.date}"></time><p>${a.description}</p><span class="author">${a.author}</span><img src="${a.image}"></article>`).join("");
export const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Journal de test</title><link>https://fixture.news/native</link><description>Articles de test</description>${articles.map(a => `<item><title>${a.title}</title><link>https://fixture.news${a.url}</link><description>${a.description}</description><pubDate>${new Date(a.date).toUTCString()}</pubDate><guid>${a.url}</guid></item>`).join("")}</channel></rss>`;
function page(body: string, head = "") { return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Journal local de test</title>${head}</head><body><main>${body}</main></body></html>`; }
export function fixtureServer(): Server {
  return createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    switch (req.url?.split("?")[0]) {
      case "/static": res.end(page(cards)); break;
      case "/native": res.end(page("<p>Lire notre journal</p>", '<link rel="alternate" type="application/rss+xml" href="/native.xml">')); break;
      case "/native.xml": res.setHeader("Content-Type", "application/rss+xml"); res.end(rss); break;
      case "/js": res.end(page(`<div id="root"></div><script>requestAnimationFrame(() => { document.getElementById('root').innerHTML = ${JSON.stringify(cards)}; });</script>`)); break;
      case "/api-page": res.end(page(`<div id="root"></div><script>fetch('/api/articles').then(r => r.json()).then(data => {document.getElementById('root').innerHTML = data.articles.map(a => '<article><h2><a href="' + a.url + '">' + a.title + '</a></h2></article>').join('');});</script>`)); break;
      case "/api/articles": res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ articles })); break;
      case "/graphql-page": res.end(page(`<div id="root"></div><script>fetch('/graphql', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'query Articles { articles { title url date description } }'}) }).then(r=>r.json()).then(data=>{document.getElementById('root').innerHTML=data.data.articles.map(a=>'<article><h2><a href="'+a.url+'">'+a.title+'</a></h2></article>').join('')});</script>`)); break;
      case "/graphql": res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ data: { articles } })); break;
      case "/malformed": res.end(page(`<script type="application/ld+json">{ broken json </script>${cards}<article><h2><a href="javascript:alert(1)">Lien dangereux</a></h2><time>date invalide</time></article>`)); break;
      case "/blocked": res.statusCode = 403; res.end("Forbidden"); break;
      case "/captcha": res.end(page('<div class="h-captcha">Verify you are not a robot</div>')); break;
      case "/empty": res.end(page("<p>Il n’y a rien ici.</p>")); break;
      case "/cover.png": res.setHeader("Content-Type", "image/png"); res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAfcAAAAASUVORK5CYII=", "base64")); break;
      default: res.statusCode = 404; res.end("Not found");
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) fixtureServer().listen(4400, "127.0.0.1", () => console.log("Fixtures : http://127.0.0.1:4400/static, /native, /js, /api-page, /graphql-page, /malformed (réservées aux tests, bloquées dans l’application)"));
