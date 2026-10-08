# Source — moteur RSS local

Application Next.js / React / TypeScript strict. Télécharge réellement les pages, extrait leurs articles et sert un RSS 2.0 enregistré dans SQLite. Aucun service hébergé, compte ou clé API n’est nécessaire. Une connexion Internet reste nécessaire pour consulter les sites publics.

## Démarrage

Sur ce poste Windows, les dépendances sont déjà présentes : double-cliquer sur **`Lancer RSS.cmd`** à la racine du projet. Le lanceur démarre le serveur en arrière-plan, attend que la page réponde, puis ouvre `http://localhost:3000` dans le navigateur habituel. Si RSS tourne déjà, il ouvre simplement la page. Les journaux sont dans `data/launcher-output.log` et `data/launcher-errors.log`. Le serveur reste actif après fermeture du navigateur ; après redémarrage de Windows, double-cliquer à nouveau sur le lanceur. Celui-ci n’active pas le tunnel public.

Node.js **22.13 minimum**, de préférence Node 24 LTS, avec npm.

```sh
npm install
npx playwright install chromium
npm run dev
```

Ouvrir **http://localhost:3000**. Saisir l’URL publique d’une rubrique ou d’un blog, cliquer sur **Analyser**, vérifier l’aperçu puis **Créer le flux RSS**. **Voir le flux** ouvre le XML ; **Copier l’URL locale** permet de l’ajouter à un lecteur tournant sur cette machine. Une URL `localhost`, `127.0.0.1` ou privée ne fonctionne **pas** dans Inoreader ou Feedly. Pour ces services, activer l’accès externe décrit ci-dessous.

`npx playwright install` fonctionne également, mais télécharge des navigateurs supplémentaires inutilisés. Sur Linux, les bibliothèques système de Chromium peuvent nécessiter `npx playwright install --with-deps chromium`.

Sur Windows, si Chromium n’est pas installé et Microsoft Edge est présent, le moteur utilise automatiquement Edge via Playwright. Pour choisir explicitement un navigateur installé, créer `.env.local` contenant `BROWSER_CHANNEL=msedge` ou `BROWSER_CHANNEL=chrome`. Les mêmes variables peuvent être définies dans le terminal pour les tests. Aucun profil personnel ni cookie du navigateur habituel n’est utilisé.

```sh
npm run typecheck
npm test
npm run build
npm start
```

Les scripts `dev` et `start` écoutent exclusivement sur `127.0.0.1`. Les données persistent dans `data/rss.sqlite`, avec journal WAL. Ne pas lancer plusieurs instances sur cette même base. Un message expérimental de Node concernant `node:sqlite` peut apparaître selon la version de Node.

## Périmètre de cette V1

Le flux `/feed/{id}` utilise les articles persistants et applique les règles de veille à la lecture. Sa consultation ne relance pas l’extraction. L’actualisation périodique, l’historique et les sélecteurs manuels sont disponibles ; les sites nécessitant une authentification restent exclus. Les brouillons non publiés de plus de 24 heures sont purgés lors d’un nouvel enregistrement. L’accès distant via tunnel est disponible sans déployer l’application.

## Accès externe avec Cloudflare Tunnel

### Premier lancement

Avec Node et npm installés, télécharger une fois le binaire officiel dans le projet :

```sh
npm run tunnel:install
```

Cet installateur Windows/Linux télécharge la dernière publication officielle `cloudflare/cloudflared` depuis GitHub, compare le SHA-256 avec l’empreinte de cette publication, puis écrit le binaire dans `.tools/` (ignoré par Git). Il ne modifie pas le PATH ni les services système. Sur macOS : `brew install cloudflared`. Un binaire déjà installé dans le PATH convient également ; sinon définir `CLOUDFLARED_PATH` dans `.env.local`.

Terminal 1 :

```sh
npm run dev
```

Terminal 2 :

```sh
npm run tunnel
```

Le script lance une passerelle locale sur **127.0.0.1:4318**, puis l’équivalent de :

```sh
cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:4318
```

**Ne pas pointer le tunnel sur le port 3000** : ce port contient l’interface Next.js et les API d’administration. Le port 4318 est une passerelle en lecture seule dédiée aux RSS. Les URL publiques gardent bien la forme `https://<domaine-généré>/feed/{id}` ; aucun port n’est visible pour le lecteur distant.

Cloudflare affiche un domaine aléatoire `https://<domaine-généré>.trycloudflare.com`. Le script le détecte dans les sorties de `cloudflared`, puis effectue un GET HTTPS de contrôle à travers cette URL. Aucune URL de tunnel n’est codée en dur. La page locale **Mes flux → détail d’un flux** affiche séparément l’URL locale et l’URL publique, ainsi que l’état de l’accès externe. Cliquer sur **Tester la compatibilité RSS** avant de copier l’URL publique dans le lecteur.

Le bouton **Activer l’accès externe** lance le même script en arrière-plan (fenêtre cachée sous Windows). Les journaux sont alors dans `data/tunnel.log`. **Désactiver l’accès externe** ou **Arrêter le tunnel en échec** ferme le processus géré et sa passerelle ; en terminal, `Ctrl+C` a le même effet. La supervision utilise un verrou de processus, un heartbeat toutes les 3 secondes et un contrôle HTTPS toutes les 15 secondes. Une URL attribuée sans connexion opérationnelle reste **Inactive**. Un état ancien expire automatiquement.

Si un fichier personnel `config.yml` ou `config.yaml` existe déjà dans le dossier `.cloudflared`, Cloudflare peut refuser un Quick Tunnel ; utiliser votre configuration nommée appropriée, sans supprimer une configuration existante à l’aveugle. Si le port 4318 est occupé, arrêter l’autre passerelle ou définir `TUNNEL_PORT` dans `.env.local` (et adapter le service Cloudflare en mode nommé).

Tous les flux **déjà publiés** sont accessibles à qui connaît leur URL ; les brouillons ne le sont pas. La passerelle n’énumère pas les flux. L’ordinateur et le processus du tunnel doivent rester allumés. La passerelle lit SQLite directement : Next.js sert l’administration, mais son arrêt seul ne ferme pas un tunnel lancé séparément. Pour retirer l’exposition, arrêter le tunnel.

### Quick Tunnel temporaire ou URL durable

Un Quick Tunnel ne nécessite ni compte Cloudflare ni domaine. Son URL change à chaque redémarrage et sa disponibilité n’est pas garantie. Il convient aux essais : après un redémarrage, modifier l’abonnement Inoreader avec la nouvelle URL. Voir la [documentation officielle des Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

Pour conserver une URL durable :

1. Créer un tunnel géré dans le tableau de bord Cloudflare, avec un compte et un domaine appropriés.
2. Configurer son nom public, par exemple `rss.votre-domaine.fr`, vers le service **HTTP `127.0.0.1:4318`**. Ne pas sélectionner `localhost:3000`.
3. Copier `.env.example` vers `.env.local`, définir `PUBLIC_BASE_URL=https://rss.votre-domaine.fr` et `TUNNEL_TOKEN=...`. Garder ce fichier privé ; ne jamais coller le jeton dans l’interface ou un dépôt.
4. Lancer `npm run tunnel:named`. Le jeton est transmis à cloudflared par la variable d’environnement `TUNNEL_TOKEN`, pas par les arguments de commande. L’URL configurée est vérifiée par le même contrôle HTTPS.

Un nom durable ne rend pas le poste disponible lorsqu’il est éteint. Les règles Cloudflare Access, CAPTCHA ou authentification placées devant le flux peuvent empêcher les lecteurs RSS de le lire. La passerelle reste restrictive même avec un domaine personnalisé. Voir [création d’un tunnel](https://developers.cloudflare.com/tunnel/get-started/) et [paramètres du connecteur](https://developers.cloudflare.com/tunnel/reference/run-parameters/).

### Compatibilité ngrok

Installer [l’agent officiel ngrok](https://ngrok.com/docs/getting-started/), puis configurer son compte localement avec la commande fournie par ngrok, généralement `ngrok config add-authtoken VOTRE_JETON`. Ne pas transmettre ce jeton à l’application. Arrêter un éventuel tunnel existant, puis :

```sh
npm run tunnel:ngrok
```

Le script exécute `ngrok http http://127.0.0.1:4318 --log stdout --log-format json` et détecte l’URL HTTPS dans les journaux JSON. Il n’utilise pas un tunnel arbitraire déjà présent sur le poste. `NGROK_PATH` permet de choisir l’exécutable ; `PUBLIC_BASE_URL` permet d’utiliser un domaine ngrok assigné à votre compte via `--url`. Les exigences de compte, domaines et quotas dépendent de l’offre ngrok. Le diagnostic ne masque pas les écrans HTML intermédiaires : s’ils remplacent le RSS, la compatibilité est déclarée en échec.

### Tester dans Inoreader, Feedly, n8n ou Make

1. Ouvrir la page locale `/feeds/{id}` et attendre **Accès externe : Actif**.
2. Cliquer sur **Tester l’URL publique** ou **Tester la compatibilité RSS**. Le diagnostic doit confirmer HTTP 200, Content-Type RSS, XML valide, RSS 2.0, channel, titres, articles, liens publics absolus, dates et GUID.
3. Copier **l’URL publique**, jamais l’URL locale.
4. Dans Inoreader, utiliser l’action d’ajout d’un abonnement/flux, coller cette URL HTTPS complète, puis s’abonner. Même principe dans Feedly ; dans n8n/Make, renseigner l’URL dans le module RSS.
5. Garder le tunnel et l’ordinateur actifs. Les actualisations des sources sont planifiées dans leurs réglages ; les flux thématiques suivent les articles stockés.

Test automatisé sur une véritable URL publique :

```sh
npm run test:public -- https://VOTRE-DOMAINE/feed/VOTRE-ID
```

Sans argument, le script prend l’URL du tunnel connu et le dernier flux publié. Il effectue un GET HTTPS avec la protection SSRF existante, parse le résultat et sort avec un code non nul si un contrôle échoue. Aucun en-tête spécial destiné à contourner une page intermédiaire n’est ajouté. Ce test part du poste local **vers l’adresse publique et traverse le service du tunnel** ; ce n’est pas une sonde indépendante hébergée sur le réseau d’Inoreader. L’ajout effectif dans le lecteur reste le contrôle propre à ce service.

### Sécurité de l’exposition

La passerelle accepte uniquement `GET` et `HEAD` sur `/feed/{id}` et `/api/public/health`. Elle sert uniquement les flux publiés de SQLite et une réponse de contrôle minimale, jamais des fichiers. Elle ne transmet aucune requête à Next.js et ignore les en-têtes `Host` / `X-Forwarded-*` pour construire les URL. `/`, `/feeds`, `/api/analyze`, `/api/tunnel`, `/api/feeds`, `/_next/*`, les sources, SQLite et `.env.local` renvoient 404 sur la passerelle ; les écritures renvoient 405. L’URL publique de référence provient du processus supervisé ou de la configuration locale.

Les routes Next.js de contrôle restent protégées par Host local et Origin. La SSRF du moteur d’extraction n’est pas relâchée pour permettre les tunnels. Les liens d’articles et de channel doivent rester des URL publiques absolues vers les sources : les liens privés/relatifs sont exclus à la sérialisation et le diagnostic signale les exclusions. Les images privées ne sont pas exportées. Un GUID URL publique utilise `isPermaLink="true"`; un identifiant source opaque reste stable avec `false`, et un ancien GUID URL privée devient une empreinte stable.

Les réponses RSS utilisent `application/rss+xml; charset=utf-8`, `Cache-Control: public, max-age=60, must-revalidate`, un ETag dérivé du XML et `Last-Modified`. Les GET conditionnels reçoivent 304, et HEAD ne renvoie pas de corps. Le serveur ne substitue jamais une page HTML à son XML RSS ; le diagnostic détecte les pages HTML qui seraient ajoutées par le fournisseur du tunnel.

### Blocage constaté sur ce poste — 26 septembre 2026

Le binaire Cloudflare 2026.9.3 a été installé et son empreinte vérifiée. L’API Cloudflare a attribué un domaine Quick Tunnel, mais le connecteur a échoué avec `dial tcp ...:7844: i/o timeout`. Ses précontrôles ont indiqué l’échec de TCP/HTTP2 et UDP/QUIC. Le GET réel sur l’URL attribuée a renvoyé **HTTP 530, Content-Type text/html**, pas un RSS. **Aucune accessibilité publique réussie n’est revendiquée sur ce réseau.** Le domaine temporaire n’est pas une URL d’abonnement utilisable tant que ce blocage persiste.

Cloudflare exige une sortie vers ses endpoints sur le port **7844**, en TCP pour HTTP/2 ou UDP pour QUIC : [règles réseau officielles](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/). Autoriser ce trafic dans un environnement où vous en avez la maîtrise, utiliser un réseau qui le permet, ou configurer l’alternative ngrok avec votre compte. Le projet ne modifie pas le pare-feu et ne contourne pas les règles du réseau. Passer de QUIC à HTTP/2 ne résout pas un blocage également appliqué à TCP 7844.

Le lecteur public automatisé a correctement échoué ; les tests locaux de la passerelle et du RSS passent indépendamment de la connectivité Cloudflare. `npm run smoke:tunnel`, application démarrée et au moins un flux publié, vérifie le démarrage et l’arrêt depuis l’interface, les deux URL, la copie locale, le diagnostic réel et l’affichage mobile ; ce contrôle ouvre temporairement un tunnel puis le ferme.

Les dates absentes ne sont pas inventées : `pubDate`, optionnel en RSS, est omis. Un auteur contenant une adresse e-mail est exporté dans `author`; un nom seul dans `dc:creator`, conformément aux conventions RSS. Les images sont référencées dans `media:thumbnail`. L’aperçu charge les images via un proxy local protégé ; une image bloquée ou indisponible n’empêche pas la lecture des articles.

## Architecture

```text
src/app/page.tsx                      Interface et progression NDJSON
src/app/api/analyze/route.ts          Analyse, annulation, limite globale
src/app/api/feeds/route.ts            Publication d’une analyse enregistrée
src/app/feed/[id]/route.ts            RSS XML persistant
src/app/api/images/[id]/[index]/      Images d’aperçu vérifiées
src/lib/engine.ts                    Orchestration et sélection
src/lib/extractors/RSSDetector.ts    RSS, Atom, RSS RDF, autodécouverte
src/lib/extractors/HTMLExtractor.ts  Cheerio, JSON-LD, microdonnées, OG, cartes
src/lib/extractors/BrowserExtractor.ts  Playwright et trafic XHR/fetch
src/lib/extractors/APIExtractor.ts   Listes REST/GraphQL imbriquées
src/lib/network.ts                   Transport borné et protection SSRF
src/lib/normalize.ts                 Nettoyage, URL, dates, dédoublonnage
src/lib/rss.ts                       Sérialisation RSS 2.0 échappée
src/lib/store.ts                     SQLite natif, requêtes paramétrées
tests/fixtures/server.ts             Pages de test réellement servies en HTTP
```

Chaque extracteur produit une `Extraction` avec `FeedItem[]`, un score de confiance, une méthode et une explication. Le format partagé contient `title`, `url`, `description`, `publishedAt`, `author`, `image`, `category`, `guid` ; les métadonnées manquantes sont optionnelles.

### Choix de la méthode

1. Téléchargement de la page et diagnostic d’accès.
2. Détection d’un RSS/Atom direct, des liens `rel=alternate`, puis `/rss`, `/feed`, `/rss.xml`, `/feed.xml`, `/atom.xml` ; dix candidats maximum, requêtes par groupes de trois.
3. Cheerio analyse le HTML, les objets JSON-LD, `Article`/`NewsArticle`/`BlogPosting`, les microdonnées, OpenGraph et les structures de cartes répétées. Le score des cartes dépend du nombre de liens/titres et de la présence de dates, descriptions ou images.
4. Si au moins trois articles HTML suffisamment fiables sont disponibles, pas de navigateur. Un article unique décrit par Schema.org ou OpenGraph suffit également.
5. Sinon, Playwright attend `DOMContentLoaded`, des indices réels d’articles puis une période d’inactivité réseau, sous délais bornés. Le DOM est analysé avec le même extracteur HTML. Les réponses JSON des requêtes XHR/fetch sont inspectées, y compris les réponses GraphQL. Le navigateur n’exécute pas les mutations GraphQL ni les formulaires POST.
6. Sélection par confiance et couverture. Une API JSON riche, sans jeton temporaire apparent, bénéficie d’un bonus. La stabilité est une **heuristique**, pas une garantie ; aucun endpoint découvert n’est recontacté automatiquement après analyse.
7. Normalisation et dédoublonnage : URL canonique (ou URL nettoyée des paramètres de tracking), GUID, URL, titre/date, empreinte du contenu. Deux URL ayant une signification distincte conservent leurs paramètres fonctionnels.

Les scores expriment la qualité des indices, pas une probabilité statistique. L’extraction générique peut manquer une mise en page atypique, une pagination, un chargement très tardif ou une API sans URL d’article explicite. La configuration par défaut conserve une page et 200 articles. Les réglages avancés autorisent 20 pages et 500 articles, le scroll infini et les boutons de chargement.

### Protection réseau et contenu

- HTTP/HTTPS uniquement, ports 80/443, aucun identifiant intégré à l’URL.
- Refus des adresses locales, privées, loopback, link-local, multicast, réservées, metadata cloud et variantes IPv4 encapsulées dans IPv6. Les noms locaux sont refusés.
- Résolution de toutes les IP du domaine : refus si une seule est non publique. L’adresse publique vérifiée est injectée dans la connexion TCP ; aucune deuxième résolution non contrôlée. Le nom d’origine reste utilisé pour SNI et la validation du certificat TLS.
- Chaque redirection repasse par ces contrôles. Maximum cinq redirections.
- Les requêtes de Playwright sont interceptées et satisfaites exclusivement par ce transport. Un proxy volontairement inutilisable bloque les connexions qui échapperaient à l’interception. Service workers, WebSocket, permissions, téléchargements, médias et popups sont bloqués ; aucun profil connecté n’est réutilisé.
- Corps HTTP : 3 Mo avant/après décompression ; budget réseau de 20 Mo téléchargés, 90 requêtes par analyse ; requête/DNS et navigation : 5–30 s ; lancement navigateur : 30 s ; session navigateur : 120 s maximum ; DOM : 4 Mo ; analyse complète : 180 s. Une seule analyse simultanée.
- Le texte est normalisé et une version HTML autorisée de la description est conservée lorsqu’elle est disponible. React l’échappe à l’affichage ; aucun `dangerouslySetInnerHTML`. Les URL `javascript:`/`data:` sont rejetées. Les SVG distants ne sont pas affichés. Le XML est échappé et les déclarations DTD/entités des flux entrants sont refusées.
- Vérification du Host local et de l’Origin des écritures pour limiter les accès depuis un site tiers et le DNS rebinding contre l’application locale.
- Aucun contournement de CAPTCHA, Cloudflare, paywall ou authentification ; diagnostics spécifiques pour refus HTTP, DNS, TLS, délais et extraction vide.

Cette application est destinée à un poste local, pas à un service multi-utilisateur exposé sur Internet. La sandbox du navigateur reste activée ; aucun `--no-sandbox` n’est ajouté.

## Tests

`npm test` lance les tests unitaires et les intégrations, y compris un véritable navigateur headless. Installer Chromium au préalable, ou utiliser le repli Edge Windows. Aucun test n’exige un site Internet disponible.

Les fixtures HTTP simulent HTML statique, RSS natif, contenu JavaScript, API REST, GraphQL, données malformées, pages bloquées et page vide. Les intégrations vérifient les 24 articles et le choix de la méthode. Les tests réseau couvrent IP interdites, DNS mixte, DNS rebinding, redirections, taille, décompression et timeout. SQLite et le XML RSS sont également vérifiés.

Un contrôle facultatif de bout en bout est disponible avec `npm run smoke`, après démarrage de l’application. Il utilise le flux public BBC par défaut (Internet requis), vérifie le refus d’une URL privée, l’aperçu, la publication du RSS, sa validité XML, la copie dans le presse-papiers et l’absence de débordement sur mobile. Il produit des captures dans `test-results/`. Une autre source peut être passée avec `npm run smoke -- https://exemple.fr/rss.xml`.

```sh
npm run fixtures
```

Les pages sont visibles dans un navigateur à `http://127.0.0.1:4400/static`, `/native`, `/js`, `/api-page`, `/graphql-page` et `/malformed`. **Elles sont intentionnellement refusées dans le champ de l’application**, comme toutes les URL locales. Les tests utilisent un adaptateur réseau défini uniquement dans `tests/`, qui mappe le domaine virtuel `https://fixture.news` vers le serveur local. Le code applicatif n’importe jamais cet adaptateur : il n’existe aucun réglage permettant de désactiver la SSRF en production.

## Références techniques

- [Next.js — Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Playwright — interception réseau et service workers](https://playwright.dev/docs/network)

## Dépannage

- `BROWSER_MISSING` : installer Chromium ou sélectionner Edge/Chrome installé.
- `HTTP_403`, `CLOUDFLARE`, `CAPTCHA`, `AUTH` : utiliser une autre source publique ou son flux officiel ; le moteur ne contourne pas ces restrictions.
- `HTTP_429` : attendre avant une nouvelle analyse.
- `EMPTY` : essayer une rubrique d’actualités plutôt qu’une page d’accueil peu structurée.
- `SSRF` : l’URL ou l’une de ses redirections pointe vers une destination interdite.
- `DNS` / `SSL` / `TIMEOUT` : vérifier l’adresse, le certificat et la connectivité. La vérification TLS n’est jamais désactivée.
- `BUSY` : attendre la fin de l’analyse en cours.
- `npm` introuvable : installer la distribution Node.js avec npm et rouvrir le terminal. Le code de l’application n’exige pas pnpm ; le verrou pnpm est fourni aussi pour l’environnement de développement utilisé ici.

## Utilisation : extraction avancée et actualisations

1. Sur l’accueil, ouvrir **Réglages avancés** pour choisir la pagination (1–20 pages), le rendu JavaScript, le scroll / « charger plus », les limites, la langue et le fuseau. Laisser Automatique pour conserver la priorité RSS → HTML → navigateur/API.
2. Créer le flux puis ouvrir **Gérer ce flux**. **Modifier extraction** ouvre les règles CSS/XPath et les paramètres. Les champs sont relatifs au conteneur ; un sélecteur vide cible le conteneur. Pour XPath, utiliser par exemple `//article` puis `.//h2` et `.//a`.
3. **Sélectionner sur la page / Charger l’aperçu** télécharge une représentation sécurisée. Sélectionner « Titre », « Date », « Image » ou « Lien », puis cliquer dans la représentation. La règle proposée privilégie classes et attributs stables. Scripts, styles distants, formulaires, images distantes et cadres ne sont pas exécutés dans cet aperçu ; le rendu visuel est donc simplifié.
4. Les correspondances CSS sont recalculées après 400 ms sur la copie chargée, avec exemples. **Tester les règles** exécute le pipeline complet ; XPath est testé avec Playwright. Un aperçu expire après dix minutes (cinq aperçus maximum en mémoire).
5. **Enregistrer les réglages**, puis **Actualiser maintenant**. Le flux conserve les articles connus en cas d’échec et affiche les nouveaux articles. Les métadonnées HTTP et les étapes horodatées sont disponibles dans **Historique**.
6. Choisir une fréquence dans les paramètres : manuel, 15/30 minutes, 1/3/6/12/24 heures. Le planificateur démarre avec Next.js, vérifie les échéances toutes les 15 secondes et utilise SQLite comme verrou partagé. Le serveur et l’ordinateur doivent rester allumés. Au redémarrage, les échéances échues sont reprises, une source à la fois. Une exécution interrompue est signalée après expiration de son verrou (quatre minutes maximum).
7. Une extraction vide, ou inférieure à 20 % de la moyenne des cinq derniers succès (baseline d’au moins dix articles), signale une règle probablement cassée. La réanalyse propose une méthode sans remplacer la règle. Comparer le nombre d’articles, les URLs, les titres et les dates, puis **Utiliser cette règle**, **Conserver l’ancienne règle** ou **Tester davantage**.

Limites : la pagination suit les liens disponibles, sur le même domaine, sans deviner une API ni forcer un bouton de navigation opaque. Scroll et boutons « Load more / Voir plus / Afficher plus / Plus d’articles / Charger plus » sont bornés (30 scrolls, 30 clics maximum, trois essais sans croissance). Une liste virtuelle ne présentant jamais des articles extractibles peut nécessiter une règle manuelle. Au maximum 500 articles connus et 200 exécutions détaillées sont conservés par source ; les clés d’articles déjà rencontrés restent en base pour le comptage des nouveautés.

## Utilisation : veille, filtres et flux thématiques

### Filtrer et transformer un flux existant

1. Ouvrir **Mes flux → Ouvrir → Filtres**. Ajouter des critères (titre, description, titre OU description, contenu disponible, URL, auteur, catégorie, site, source, date).
2. Choisir contient / ne contient pas / commence / finit / égal / différent / Regex. La casse est ignorée, sauf activation de **Respecter la casse**.
3. Les groupes **ET** exigent tous leurs enfants ; **OU** au moins un ; **NON** exclut les articles correspondant à l’un de ses enfants. Les groupes peuvent être imbriqués. Un groupe vide laisse passer les articles. Limites : 60 nœuds, cinq niveaux, 200 caractères par Regex.
4. Pour les périodes, choisir le champ **Date**, puis derniers jours (1 = 24 h, 7, 30), avant ou après. Les dates manquantes ou futures sont exclues d’une période récente. Les filtres temporels sont réévalués lors de la lecture du flux.
5. **Tester le filtre** affiche analysés, conservés, exclus par filtre, doublons retirés, dix articles et les scores des doublons. **Enregistrer** actualise immédiatement le RSS sans réseau ni Playwright.
6. Dans **Transformations**, ajouter un modèle (`[PSC] {titre}`, `[{source}] {titre}`), suppression de suffixe/bloc, recherche/remplacement, Regex, normalisation des espaces ou longueur maximale. Les transformations sont ordonnées. Description : texte brut ou HTML nettoyé par liste de balises/attributs autorisés. Le HTML est échappé dans XML et affiché comme texte dans l’interface.

Le champ **Contenu disponible** correspond au texte reçu de la source ; l’application ne télécharge pas automatiquement le corps complet de chaque article. Une ancienne extraction sans HTML ne peut pas retrouver un formatage perdu. Les prochaines extractions conservent le HTML de description disponible. Les Regex s’exécutent par lots dans un contexte à durée limitée (75 ms par lot) ; un motif trop coûteux est rejeté avec une explication.

### Créer plusieurs flux depuis une source ou agréger

1. Dans le tableau de bord, cliquer **Flux thématique / agrégé**, ou **Créer un flux dérivé** sur un flux existant.
2. Choisir un nom et **Flux filtré depuis une source**, ou **Flux agrégé / thématique** avec plusieurs sources (30 maximum). Une même source peut alimenter plusieurs flux avec des URLs RSS distinctes.
3. L’assistant thématique construit un groupe OU depuis les mots-clés et un groupe NON depuis les exclusions (une expression par ligne). Affiner ensuite les groupes visuels.
4. Configurer tri et doublons : URL, titre normalisé, similarité lexicale du titre, ou similarité avec dates proches. Régler le seuil et choisir premier détecté / plus récent / les deux / source prioritaire. Pour les priorités, cliquer les sources dans l’ordre souhaité.
5. Tester, puis **Créer le flux RSS thématique**. L’URL `/feed/{id}` fonctionne aussi par le tunnel déjà configuré. Les sources sont actualisées selon leurs propres fréquences ; **Recalculer** sur un agrégat ne retélécharge pas ses sources.

Pipeline : extraction → normalisation/dédoublonnage source → articles persistants → filtres/transformations de chaque source → union des sources → filtres/transformations de l’agrégat → dédoublonnage et tri → RSS. Les cycles et dépendances manquantes sont refusés. Une source utilisée par un autre flux ne peut être supprimée avant d’en être retirée. Profondeur maximum : huit flux ; union maximum : 5000 articles. La comparaison des doublons a un budget CPU de deux secondes ; réduire le nombre de sources ou choisir URL/titre si ce budget est atteint.

La similarité est un Dice sur les mots normalisés du titre, sans accents, ponctuation ou mots-outils courants. Ce score n’est **pas** une compréhension sémantique : deux événements distincts peuvent avoir des titres proches. Le diagnostic permet de contrôler les articles retirés avant d’enregistrer. Les articles sans date ne sont rapprochés par date que si leur URL est identique.

### Organiser, rechercher et marquer des favoris

- **Filtres → Organisation** : dossier principal (ex. `Santé / Hôpitaux`), tags séparés par virgules et favori du flux.
- **Mes flux** : recherche dans les noms, URLs, sources et articles retenus, filtres dossier/tag/statut/favoris, tri nom/actualisation/nombre d’articles. La recherche affiche jusqu’à 50 articles correspondants.
- L’étoile d’un article l’ajoute aux **Favoris**. Les favoris d’articles sont conservés séparément, même si l’article sort ensuite de la fenêtre du flux. La vue détail affiche les 50 premiers articles ; le RSS contient tous les résultats.

### Importer et exporter

Dans **Mes flux → Importer / Exporter** :

- Importer un `.opml` / `.xml` d’Inoreader, Feedly ou autre lecteur : noms, URLs RSS et dossiers imbriqués. Les sources sont créées vides ; cliquer **Actualiser** pour télécharger leurs articles. Aucun téléchargement n’est lancé uniquement par le parsing OPML.
- Exporter OPML : tous les flux, le dossier choisi ou les cases sélectionnées. `xmlUrl` pointe vers le RSS généré, avec le domaine HTTPS du tunnel actif. Sans tunnel actif, les URLs sont locales, utilisables seulement depuis ce poste. Pour Inoreader/Feedly distant, activer d’abord un tunnel fonctionnel.
- Exporter JSON : configuration versionnée (URLs, réglages d’extraction, règles manuelles, filtres, transformations, dépendances, dossiers, tags, favoris des flux). Les dépendances d’un agrégat sélectionné sont automatiquement incluses.
- Importer JSON : restauration avec de nouveaux identifiants et remappage des dépendances, sans écraser les flux existants. Les articles et journaux ne sont pas inclus dans cette sauvegarde de configuration. Pour une sauvegarde exhaustive, arrêter l’application puis copier `data/rss.sqlite`.
- Limites : 1 Mo et 200 flux par import ; OPML sans DTD/entités externes, URLs privées refusées. Un import invalide est rejeté avant écriture ; les insertions valides sont transactionnelles. Les paramètres et filtres JSON sont revalidés.

### Validation et architecture ajoutées

```text
src/lib/settings.ts, dates.ts, pagination.ts     Paramètres bornés, dates, navigation
src/lib/extractors/ManualExtractor.ts            CSS et XPath
src/lib/editor.ts                              Aperçu sécurisé et tests de sélecteurs
src/lib/refresh.ts, src/instrumentation.ts      Actualisations, propositions, planification
src/lib/watch-types.ts, watch-config.ts        Modèles et validation des règles
src/lib/watch.ts                               Filtres, transformations, union, similarité
src/lib/interchange.ts                         Import/export OPML et JSON
src/lib/sanitize-html.ts                       Liste d’autorisation HTML
src/app/api/manage/[id]/, api/editor/, api/watch/  API locale protégée
```

Les migrations SQLite sont additives : `feed_state`, `refresh_log`, `seen_items`, `proposals`, `engine_lease`, `watch_config`, `article_favorites`. Le stockage singleton se renouvelle lors des changements de version en développement, pour éviter des méthodes manquantes après rechargement à chaud de Next.js.

```sh
npm test
npm run typecheck
npm run build
# Avec le serveur lancé et au moins une source publiée contenant des articles :
npm run smoke:watch
```

`tests/advanced.test.ts` couvre pagination, dates, CSS/XPath, scroll, chargement supplémentaire, règle cassée, proposition/adoption et verrou du planificateur. `tests/watch.test.ts` couvre AND/OR/NOT, casse, Regex pathologique, dates, transformations, similarité, agrégation, cycles, OPML/JSON. `smoke:watch` teste l’interface et le RSS via une copie temporaire d’une source, puis supprime ses flux de test. Les captures desktop/mobile sont dans `test-results/`.

## Publication autonome avec GitHub Pages

Le générateur `npm run feeds:build` réutilise le moteur et les règles sans serveur Next.js. Le workflow `.github/workflows/publish-rss.yml` actualise les sources toutes les trois heures, sauvegarde l’état chiffré sur une branche dédiée et déploie uniquement les XML et l’index.

Voir [DEPLOIEMENT_GITHUB.md](DEPLOIEMENT_GITHUB.md) pour l’audit, l’export **GITHUB** depuis le tableau de bord, la clé `RSS_STATE_KEY`, la configuration Pages et la première exécution. La configuration livrée est un exemple BBC public ; exportez vos flux avant de publier. Aucun déploiement distant n’est effectué par les commandes de génération locale.
