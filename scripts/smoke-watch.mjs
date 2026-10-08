import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { XMLValidator, XMLParser } from 'fast-xml-parser';
const base='http://localhost:3000';
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL??(!existsSync(chromium.executablePath())?'msedge':undefined)});
const created=[];let context;
try {
 context=await browser.newContext({viewport:{width:1360,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const post=async(path,body)=>{const r=await context.request.post(base+path,{headers:{Origin:base},data:body});const data=await r.json();assert.ok(r.ok(),JSON.stringify(data));return data;};
 const library=await (await context.request.get(base+'/api/watch')).json();assert.ok(library.rows?.length,'Une source publiée est requise pour ce smoke test.');
 const original=library.rows.find(r=>r.watch.kind==='source'&&r.raw.items.length);assert.ok(original);
 const copy=await post('/api/manage/'+original.feed.id,{action:'duplicate'});created.push(copy.id);
 await page.goto(base+'/feeds');await page.getByRole('searchbox',{name:'Recherche globale'}).fill(original.feed.title+' (copie)');await page.getByRole('link',{name:original.feed.title+' (copie)',exact:true}).waitFor();
 await page.goto(base+`/feeds/${copy.id}/rules`);await page.getByRole('button',{name:'+ Critère',exact:true}).click();await page.getByLabel('Valeur du critère',{exact:true}).fill(original.raw.items[0].title.split(' ')[0]);
 await page.getByRole('button',{name:'Tester le filtre',exact:true}).click();await page.locator('.preview').waitFor();assert.match(await page.locator('.preview').innerText(),/Articles analysés/);
 await page.getByRole('button',{name:'+ Transformation',exact:true}).click();await page.getByLabel('Texte ou longueur',{exact:true}).fill('[TEST VEILLE] {titre}');await page.getByLabel('Dossier principal').fill('Tests / Veille');await page.getByLabel('Tags (séparés par des virgules)').fill('PSC,Test');
 await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await page.getByRole('status').filter({hasText:'Règles enregistrées'}).waitFor();
 const rss=await context.request.get(base+'/feed/'+copy.id);assert.equal(rss.status(),200);const xml=await rss.text();assert.equal(XMLValidator.validate(xml),true);const parsed=new XMLParser().parse(xml);const items=Array.isArray(parsed.rss.channel.item)?parsed.rss.channel.item:[parsed.rss.channel.item];assert.ok(items[0].title.startsWith('[TEST VEILLE]'));
 await page.goto(base+`/veille/new?source=${copy.id}`);await page.getByLabel('Nom du flux',{exact:true}).fill('Test agrégé temporaire');await page.getByRole('button',{name:'Tester le filtre',exact:true}).click();await page.locator('.preview').waitFor();
 await page.getByRole('button',{name:'Créer le flux RSS thématique',exact:true}).click();await page.waitForURL('**/feeds/*');const result={id:new URL(page.url()).pathname.split('/').pop()};assert.ok(result.id);created.push(result.id);

 await page.locator('#articles .search-result').first().waitFor();const wasFavorite=library.favorites.some(i=>i.url===items[0].link);if(!wasFavorite)await page.locator('#articles .star-button').first().click();await page.locator('#articles .star-button').first().filter({hasText:'★'}).waitFor();
 const favored=(await (await context.request.get(base+'/api/watch?favorites=1')).json()).favorites;assert.ok(favored.length);if(!wasFavorite)await post('/api/watch',{action:'articleFavorite',url:items[0].link,enabled:false});
 const opml=await context.request.get(base+`/api/watch?export=opml&ids=${result.id}`);assert.equal(opml.status(),200);assert.equal(XMLValidator.validate(await opml.text()),true);
 const json=await (await context.request.get(base+`/api/watch?export=json&ids=${result.id}`)).json();assert.equal(json.format,'source-rss');assert.ok(json.feeds.length>=2);
 await page.goto(base+'/feeds');await page.getByLabel('Dossier',{exact:true}).selectOption('Tests / Veille');assert.ok(await page.getByRole('link',{name:original.feed.title+' (copie)',exact:true}).count());
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/watch-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/watch-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({filterPreview:true,save:true,rssXML:true,transformation:true,derivedPreview:true,create:true,favorite:true,opml:true,json:true,folder:true,mobile:true,browserErrors:errors}));
}finally{
 if(context)for(const id of created.reverse())await context.request.post(base+'/api/manage/'+id,{headers:{Origin:base},data:{action:'delete'}});
 await browser.close();
}
