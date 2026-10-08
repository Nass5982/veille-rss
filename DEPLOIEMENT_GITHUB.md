# Déployer les flux RSS sur GitHub Pages

L’application locale reste votre outil d’administration. GitHub Actions exécute le même moteur sans serveur Next.js, puis GitHub Pages héberge uniquement des fichiers XML et un index HTML. **Aucun déploiement distant n’a été effectué pendant la préparation du projet.**

## 1. Audit du projet et choix d’architecture

| Élément existant | Rôle | Où il fonctionne |
|---|---|---|
| Next.js 16.3.6, React 19.3.0, routes `src/app/` | Création, éditeur CSS/XPath, sélection visuelle, recherche, favoris, diagnostic | Application locale ou serveur Node permanent, pas GitHub Pages |
| `src/lib/engine.ts` et `extractors/` | RSS/Atom, HTML/Cheerio, Playwright, XHR/fetch/GraphQL, pagination, scroll | Local et jobs GitHub Actions |
| `network.ts` | DNS/IP vérifiés, redirections contrôlées, SSRF, tailles/délais | Inchangé dans les deux environnements |
| `normalize.ts`, `dates.ts` | URLs, dates, données nettoyées, dédoublonnage | Local et Actions |
| `watch.ts` | ET/OU/NON, Regex, transformations, agrégation, similarité | Local et Actions |
| `store.ts`, SQLite natif Node | Articles, paramètres, historiques, clés déjà vues, propositions | SQLite locale conservée ; adaptateur SQLite **en mémoire** dans le générateur |
| `refresh.ts`, `instrumentation.ts` | Actualisation, détection de règles cassées, planification locale | Fonction d’actualisation réutilisée par Actions ; boucle du planificateur uniquement locale |
| `/feed/{id}`, `rss.ts`, `feed-response.ts` | XML dynamique, headers, ETag, Last-Modified | Route locale inchangée ; Actions appelle directement le sérialiseur pour écrire les XML |
| `interchange.ts` | Export JSON, OPML, validation des règles | Réutilisé pour l’export destiné à Actions |
| Tunnel Cloudflare/ngrok | Accès externe à un serveur local actif | Toujours disponible localement ; inutile pour Pages |

Dépendances existantes : Node ≥22.13 (Node **24** fixé dans le workflow), Cheerio 1.2.0, Playwright 1.63.0, fast-xml-parser 5.11.1, ipaddr.js 2.5.0, TypeScript strict 5.9.3. Aucune dépendance npm supplémentaire. `package-lock.json` reste la référence de `npm ci`. Les scripts `dev`, `start`, `build`, `test`, `typecheck`, fixtures, smoke et tunnel sont conservés.

Le projet local contient une base `data/rss.sqlite` et des fichiers de supervision du tunnel. Ils ne doivent jamais être envoyés dans la branche du code ni dans Pages. L’audit de motifs de secrets n’a trouvé aucun jeton GitHub, clé privée ou clé AWS dans les fichiers de code/configuration contrôlés ; ce contrôle ne remplace pas la revue humaine des noms de flux, filtres et URLs avant publication. Seul `.env.example` était présent lors de l’audit. `.env*`, `data/`, les bases, états, journaux et artefacts de génération sont exclus par `.gitignore`.

```text
Administration locale
  → export config/feeds.json (IDs et règles conservés)
  → GitHub Actions : restauration JSON chiffré → SQLite en mémoire
  → moteur existant → actualisations → filtres / transformations / agrégats
  → validation RSS/XML → sauvegarde chiffrée durable
  → artefact limité à public-rss/ → GitHub Pages → lecteur RSS
```

## 2. Tester la génération sur votre ordinateur

Depuis la racine du projet, avec Node.js 24 et npm installés :

```sh
npm install
npx playwright install chromium
npm run feeds:build -- --base-url https://VOTRE-COMPTE.github.io/VOTRE-DEPOT
npm run feeds:validate
```

Le fichier `config/feeds.json` livré contient **uniquement un exemple BBC public** ; remplacez-le par votre export pour publier vos flux. Le domaine passé ci-dessus doit être remplacé par votre future URL Pages réelle. Il sert aux liens RSS `atom:self` et à l’index ; cette commande ne contacte pas Pages et ne déploie rien.

Sortie :

```text
public-rss/
  .nojekyll
  index.html
  feeds/
    bbc-news.xml
```

Vous pouvez configurer des slugs `assurance`, `psc`, `prevoyance` pour obtenir `feeds/assurance.xml`, etc. Le générateur ne copie jamais récursivement le projet : il écrit uniquement ces fichiers autorisés. Le validateur refuse les fichiers inattendus, les liens symboliques, le XML incorrect, les GUID dupliqués, les dates invalides et les liens d’articles privés ou relatifs.

Sans clé, les essais locaux conservent un JSON dans `.rss-state/state.json`, **ignoré par Git**. Sa disparition réinitialise les essais locaux. Sur Actions, la clé et l’état chiffré sont obligatoires, et une absence d’état n’est jamais réinitialisée sans votre choix explicite au premier lancement.

Commandes ajoutées :

| Commande | Fonction |
|---|---|
| `npm run feeds:export` | Exporte les flux publiés locaux vers `config/feeds.json` |
| `npm run feeds:build` | Génère les flux ; fournir `--base-url` ou la variable `RSS_PUBLIC_BASE_URL` |
| `npm run feeds:validate` | Parse et contrôle les XML et les fichiers du dossier public |
| `npm run feeds:key` | Produit une clé aléatoire de chiffrement à conserver secrète |
| `npm run feeds:seed` | Exporte les articles/historiques locaux dans un état **chiffré** initial |

Options du générateur : `--config chemin.json`, `--state chemin`, `--output dossier`, `--base-url https://…`. L’export accepte `--ids id1,id2`. Les scripts ne chargent pas automatiquement `.env.local` ; utilisez les variables d’environnement de votre terminal ou les Secrets GitHub.

## 3. Exporter vos configurations depuis l’application

1. Démarrer `npm run dev`, ouvrir `http://localhost:3000/feeds`.
2. Dans **Importer / Exporter**, utiliser **Exporter tout (GITHUB)**, ou cocher les flux et choisir **Sélection** sous GITHUB.
3. Enregistrer le JSON téléchargé sous `config/feeds.json`. Les sources nécessaires aux agrégats sont incluses ; celles qui n’étaient pas sélectionnées ont `publication.publish: false` (elles sont extraites, mais n’ont pas de XML public).
4. Vérifier le fichier : noms, mots-clés, dossiers, tags, URLs et règles seront visibles si le dépôt est public. Les articles, cookies, SQLite, favoris d’articles et journaux ne sont pas inclus.
5. Pour des noms de fichiers lisibles, modifier `publication.slug` **avant la première publication** :

```json
"publication": { "slug": "psc", "publish": true }
```

Les IDs existants et `sourceIds` restent inchangés : contrairement à un import de sauvegarde locale, ils ne sont pas régénérés. Les slugs sont indépendants des titres. Ne modifiez plus l’ID, le slug ou l’URL source d’un flux déjà publié ; créez une nouvelle identité pour une nouvelle source. Le générateur refuse une modification d’identité incompatible avec l’état enregistré.

L’export bloque certains champs/URLs évoquant des secrets (token, cookie, clé API, identifiants dans une URL, etc.). Il ne peut pas décider si un mot-clé commercial ou un titre est confidentiel : vérifiez-les. Cette architecture vise les sources publiques, sans jeton, cookie ni authentification.

Alternative sans interface :

```sh
npm run feeds:export
# Ou une sélection, avec ses dépendances :
npm run feeds:export -- --ids ID-PSC,ID-PREVOYANCE
```

Un nouvel export redonne par défaut un slug égal à l’ID. Si vous avez choisi des slugs personnalisés, **reportez leurs valeurs existantes** dans le nouvel export avant de le pousser ; le contrôle d’identité empêchera une casse silencieuse des abonnements.

## 4. Créer et connecter le dépôt GitHub

Créer un dépôt vide dans GitHub (**New repository**), sans README généré. Un dépôt public convient si son code et ses configurations peuvent être publics. L’utilisation de Pages avec un dépôt privé dépend de votre offre GitHub ; un site Pages peut néanmoins être public. Vérifier les modalités de votre compte.

Le dossier est déjà initialisé avec Git, mais aucun remote n’était configuré pendant l’audit. Depuis ce dossier :

```sh
git status
git branch -M main
git add .gitignore .env.example package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts
# Le dossier .github est nécessaire même s’il est masqué dans l’explorateur.
git add src scripts tests config .github README.md DEPLOIEMENT_GITHUB.md AGENTS.md
git diff --cached --stat
git diff --cached
# Vérifier qu’aucun data/, .env, état ou dossier public-rss n’est indexé.
git commit -m "Préparer la publication RSS autonome sur GitHub Pages"
git remote add origin https://github.com/VOTRE-COMPTE/VOTRE-DEPOT.git
git push -u origin main
```

Si `origin` existe déjà, contrôler `git remote -v` et utiliser ce dépôt ou `git remote set-url origin …` intentionnellement. Ne forcez pas un push pour résoudre un dépôt distant non vide.

Ne pas envoyer `node_modules/`, `.next/`, `.tools/`, `.playwright/`, `.env*` (sauf `.env.example` sans secrets), `data/`, `.rss-state/`, `public-rss/`, SQLite, cookies, journaux ou captures de test. Le site est déployé depuis l’artefact Actions, pas en committant `public-rss/`.

## 5. Configurer la persistance et GitHub Pages

### Clé de chiffrement

```sh
npm run feeds:key
```

Copier uniquement la chaîne base64 produite dans **Settings → Secrets and variables → Actions → New repository secret** :

- Nom : `RSS_STATE_KEY`
- Valeur : cette clé aléatoire de 32 octets.

Conservez une copie dans votre gestionnaire de mots de passe. Ne la mettez jamais dans `feeds.json`, `.env.example`, un commit, un ticket ou les messages du workflow. Perdre la clé empêche de restaurer les états chiffrés. La changer seule rend l’état illisible ; une rotation exige de déchiffrer/réchiffrer l’état avec les bonnes clés.

### Pages et permissions

Dans **Settings → Pages → Build and deployment → Source**, choisir **GitHub Actions**. Ne choisissez pas la branche `rss-state` comme source de Pages.

Autoriser les GitHub Actions officielles utilisées dans le dépôt. Le workflow demande `contents: write` seulement pour son job de génération/persistance, `pages: read` pour récupérer l’URL du site ; son job de déploiement demande seulement `pages: write` et `id-token: write`. Une politique d’organisation peut limiter ces droits ; demander à l’administrateur l’autorisation de créer/mettre à jour la branche `rss-state`. Il n’est pas nécessaire de créer un PAT pour le fonctionnement normal : le `GITHUB_TOKEN` éphémère suffit.

Les actions sont fixées sur des commits officiels vérifiés : checkout v7, setup-node v7, configure-pages v5, upload-pages-artifact v4, deploy-pages v4. Pas de déclenchement sur pull request ; le workflow manuel est limité à la branche par défaut. Le checkout ne conserve pas les identifiants Git dans le répertoire de travail.

## 6. Premier lancement, puis toutes les trois heures

1. Ouvrir **Actions → Publier les flux RSS → Run workflow**.
2. Choisir la branche par défaut (`main`).
3. À la **toute première exécution uniquement**, cocher `initialize_state` pour autoriser la création de la branche `rss-state` si elle manque.
4. Exécuter. Les logs indiquent les nombres d’articles et les URLs de sortie.
5. Les lancements suivants se font sans cocher cette option. Le cron `17 */3 * * *` démarre à la minute 17 toutes les trois heures **UTC**, indépendamment du fuseau du poste local.

Le workflow installe Node 24, `npm ci`, Chromium et ses bibliothèques Linux, restaure l’état chiffré, génère/valide les XML, sauvegarde l’état, puis déploie le dossier public. `concurrency` interdit le chevauchement, sans annuler une exécution en cours. Aucun `npm run dev`, `next start` ou `next build` n’est nécessaire dans Actions.

Le job de build est limité à 30 minutes ; la génération à 21 minutes côté workflow, avec un budget interne d’environ 18 minutes avant de commencer une nouvelle source et trois minutes maximum par source. Le déploiement est limité à dix minutes. Une seule extraction à la fois, maximum 30 flux configurés ; les limites réseau, DOM, pagination et scroll existantes restent actives.

Les fréquences individuelles de l’application locale ne déterminent pas ce cron : **toutes les sources présentes dans la configuration sont actualisées à chaque job**. Retirez de la configuration une source que vous ne voulez pas télécharger. Pour changer la cadence, modifier le cron dans le workflow en respectant les sites et les quotas GitHub.

## 7. État durable et reprise après incident

`rss-state` est une branche indépendante créée par l’API Git Data. Elle ne contient qu’un `state.enc` : JSON compressé, chiffré et authentifié avec AES-256-GCM, nonce aléatoire à chaque écriture. Même dans un dépôt public, l’état n’est pas stocké en clair. La clé reste un Secret Actions. L’état et la clé ne sont jamais inclus dans l’artefact Pages.

Ce JSON conserve, par ID de flux : les derniers articles connus (500 maximum comme dans l’application), GUID, dates originales/détection, clés déjà rencontrées, index durable des GUID/dates par empreinte d’URL (y compris après sortie de la fenêtre de 500 articles), et les 20 dernières exécutions. SQLite en mémoire sert uniquement d’adaptateur pour réutiliser les services existants ; ce n’est pas la persistance du runner. Aucun cache ou artefact à durée limitée n’est utilisé comme source de vérité.

- Un échec temporaire conserve les derniers articles connus et le dernier contenu de la source ; les filtres, notamment temporels, restent appliqués.
- Une première source sans articles et en échec fait échouer le job : pas de déploiement partiel.
- Une source dont le nombre d’articles s’effondre utilise le diagnostic de règle cassée existant. Aucune règle n’est adoptée silencieusement sur Actions ; corrigez-la localement puis exportez.
- Une clé incorrecte, un état corrompu, un fichier manquant dans une branche existante ou un conflit d’écriture provoque un arrêt, jamais un effacement automatique.
- L’état est sauvegardé **avant** le déploiement. Si le déploiement échoue, l’ancien site reste servi ; le prochain lancement repart de l’état déjà sauvegardé.
- La branche d’état utilise des commits descendants, sans force-push. Son historique permet de retrouver une version antérieure. Sauvegardez également la clé hors GitHub.
- Les contenus historiques chiffrés font grandir le dépôt à chaque actualisation. Compression et rétention bornent l’état courant, pas toute l’histoire Git. Surveillez sa taille ; une maintenance de l’historique doit être préparée avec sauvegarde, hors workflow. État limité à 40 Mo après décodage et à 100 identités mémorisées.

### Facultatif : démarrer avec vos articles locaux existants

Cela évite de repartir seulement des articles visibles aujourd’hui sur les sites. Exportez d’abord la configuration, définissez `RSS_STATE_KEY` **dans votre terminal local** avec la même valeur que dans GitHub, puis :

```sh
npm run feeds:seed -- --state .rss-state/initial/state.enc
```

Avant le premier lancement Actions, créer la branche `rss-state` séparément à partir d’un dossier temporaire ne contenant que **ce fichier chiffré**. Exemple PowerShell (adapter le dépôt) :

```powershell
$seedFolder = Join-Path $env:TEMP ("rss-state-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $seedFolder
Copy-Item -LiteralPath '.rss-state/initial/state.enc' -Destination (Join-Path $seedFolder 'state.enc')
git -C $seedFolder init -b rss-state
git -C $seedFolder add state.enc
git -C $seedFolder commit -m "Initial encrypted RSS state"
git -C $seedFolder remote add origin https://github.com/VOTRE-COMPTE/VOTRE-DEPOT.git
git -C $seedFolder push origin rss-state
```

Ne faites ceci que si la branche n’existe pas encore. N’ajoutez jamais la clé ni la base au dossier temporaire. Le premier workflow peut alors être lancé **sans** `initialize_state`.

## 8. Trouver les URLs et les ajouter dans Inoreader

Après succès du job `deploy`, cliquer sur l’URL de l’environnement **github-pages**, également indiquée dans **Settings → Pages**. Pour un dépôt de projet classique :

```text
https://VOTRE-COMPTE.github.io/VOTRE-DEPOT/
https://VOTRE-COMPTE.github.io/VOTRE-DEPOT/feeds/psc.xml
```

Un dépôt `VOTRE-COMPTE.github.io` ou un domaine personnalisé peut avoir une autre base ; le workflow utilise `configure-pages.outputs.base_url` et ne code pas le nom du dépôt en dur.

Ouvrir l’index, copier le lien XML choisi, puis dans Inoreader **Ajouter un abonnement / Flux**, coller cette URL. Même principe dans Feedly. Ce sont des fichiers HTTPS hébergés par GitHub : votre ordinateur peut être éteint. Les anciennes URLs `localhost:3000/feed/{id}` restent locales et ne deviennent pas publiques automatiquement ; remplacez les abonnements distants par les nouvelles URLs Pages.

GitHub Pages détermine les headers HTTP. L’application locale continue à servir `application/rss+xml; charset=utf-8`. Sur Pages, l’extension `.xml` peut être servie en `application/xml` ou `text/xml` : le générateur ne peut pas imposer un header serveur personnalisé. Les documents sont en UTF-8 avec déclaration XML, RSS 2.0, `channel`, liens absolus publics, GUID stables et dates RFC 822/1123. Le contrôle local valide le fichier réel avec `fast-xml-parser` et les règles RSS partagées ; le contrôle de Content-Type externe nécessite que le site soit réellement déployé.

## 9. Mettre à jour la configuration

Modifier vos flux localement, exporter GITHUB à nouveau, préserver les IDs/slugs existants, vérifier le diff puis :

```sh
git add config/feeds.json
git diff --cached
git commit -m "Mettre à jour les règles RSS"
git push
```

Déclencher manuellement le workflow ou attendre le prochain créneau. Le workflow ne se déclenche pas sur chaque push : cela évite une extraction inattendue à chaque changement du code. Retirer un flux de la configuration retire son fichier du prochain site ; les anciens abonnements à cette URL n’auront plus de document. Une simple modification du titre, des filtres ou des sélecteurs conserve le chemin XML.

## 10. Dépannage et limites

| Symptôme | Vérification / action |
|---|---|
| `RSS_STATE_KEY` absent/invalide | Secret de dépôt, 32 octets base64, aucun espace ajouté |
| Branche absente | Première exécution : `initialize_state`. Si elle existait avant, restaurer la branche plutôt que réinitialiser |
| `STATE_CORRUPT` | Clé incorrecte ou sauvegarde endommagée ; restaurer une version connue, ne pas effacer l’état |
| `STATE_IDENTITY` | Reprendre le slug et l’URL source d’origine, ou attribuer un nouvel ID |
| `GITHUB_STATE` HTTP 403 | Permissions Actions/organisation/règles de branches empêchant `contents: write` |
| `configure-pages` échoue | Activer Pages avec la source GitHub Actions ; vérifier votre offre GitHub et les permissions |
| XML 404 après déploiement | Vérifier la base du dépôt et `publication.slug`, attendre la fin de `deploy` |
| 403 / CAPTCHA / Cloudflare / paywall | Le site peut refuser les IP GitHub Actions. Aucun contournement ; utiliser un flux natif public ou une autre source |
| `SELECTOR_BROKEN` | Tester/corriger dans l’interface locale et exporter la règle mise à jour |
| Timeout / limite | Réduire sources, pages, scrolls, nombre d’articles ; ne pas multiplier les navigateurs |
| Cron en retard / désactivé | Le planning n’est pas une garantie temps réel ; vérifier l’activité du dépôt et l’onglet Actions |
| Pas de `npm` dans le terminal | Installer Node.js avec npm et rouvrir le terminal |
| `EPERM` lors d’un `next build` local sous OneDrive | Fichiers de build verrouillés/synchronisés ; fermer les processus concernés ou travailler hors OneDrive. Sans incidence sur `feeds:build` sur Linux |

GitHub documente des retards possibles du planning et la désactivation de workflows planifiés après 60 jours d’inactivité sur les dépôts publics. Vérifiez périodiquement Actions. La facturation, les quotas et la disponibilité de Pages privé dépendent de l’offre ; aucun forfait ni coût nul illimité n’est supposé.

Pages est statique : pas d’API d’administration, recherche serveur, SQLite, éditeur visuel ou actualisation à la demande sur le site public. Ces fonctions restent disponibles dans l’application locale. Pas de promesse que toutes les sources acceptent l’extraction depuis un datacenter. La sauvegarde chiffrée protège le stockage technique ; le contenu effectivement inclus dans vos flux est, lui, volontairement public.

Références officielles : [workflows personnalisés Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [événements planifiés](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [configuration Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [setup-node](https://github.com/actions/setup-node), [checkout](https://github.com/actions/checkout).
