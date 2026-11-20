# Films vus — le carnet de Fleur & Noé

Node **26.5** conseillé (minimum 24), npm, SQLite intégré à Node ; aucun serveur de base à installer.
Les fichiers TypeScript ESM sont exécutés directement par Node, sans compilation ni chargeur.

```powershell
npm install
# Si .env n'existe pas : Copy-Item .env.example .env
npm run import:xlsx
npm run dev
```

`npm run dev` lance Fastify sur `http://127.0.0.1:3210` et Vite sur
`http://127.0.0.1:4200` : ouvrir **l’adresse Vite**. Vite relaie `/api` et `/posters`
vers Fastify, sans CORS ni clé dans le navigateur. `PORT` règle le port de l’API,
`VITE_PORT` celui de Vite si les ports habituels sont occupés ou réservés.
Les deux serveurs tournent dans le même processus et se ferment ensemble avec Ctrl+C.
Vite recharge les changements du frontend ; relancer `dev` après une modification serveur.
La clé **OMDb reste dans `.env`**, chargé
par `--env-file-if-exists` ; renseigner `OMDB_API_KEY` si nécessaire. `.env.example`
ne contient aucune clé. `PORT`, `DB_PATH`, `POSTERS_DIR` et `OMDB_DAILY_BUDGET` sont configurables.
La source `data/source/filmsvus.xlsx` (feuille `Liste`), la base `data/films.db`,
les affiches `data/posters/` et `.env` sont ignorés par Git.

| Commande | Effet |
| --- | --- |
| `npm run dev` | API Fastify + Vite avec rechargement du frontend |
| `npm start` | API + SPA de `dist/` en production, sans surveillance |
| `npm run import:xlsx` | Import idempotent, clé titre + date ; résumé en sortie |
| `npm run hydrate -- --limit 20` | Enrichissement par lots, environ un appel/s |
| `npm run export:data -- --out data/export` | Archive cohérente de la base et des affiches ; [transfert et sauvegardes](deploy/DONNEES.md) |
| `npm run user -- add <nom>` | Créer un compte local ; `passwd <nom>`, `remove <nom>`, `list` pour le gérer |
| `npm test` | Tests `node:test`, SQLite temporaire, réseau entièrement simulé |
| `npm run typecheck` | Vérification TypeScript stricte du serveur, des scripts, tests et de `web/` |
| `npm run build` | Typecheck puis build Vite de la SPA dans `dist/` |

Pour la production : `npm run build`, puis `npm start`, et ouvrir l’adresse Fastify.
`start` active explicitement le service de `dist/` et le fallback SPA : un accès
direct à `/film/42`, `/ajouter` ou `/stats` fonctionne aussi après rechargement.
`/posters/*` sert les affiches locales dans les deux modes.

La lecture est publique : liste, notes, fiches (résumé personnel et commentaire
inclus) et statistiques. Pour ajouter, modifier, rechercher un candidat ou
enrichir, se connecter sur `/connexion`. En développement aussi, créer d'abord
un compte local avec `npm run user -- add noe`. Il n'y a ni inscription ni rôles.
Les identifiants acceptent 2 à 32 lettres ASCII, chiffres, points, tirets ou
underscores, sans distinction de casse. Les mots de passe ont au moins
10 caractères : la CLI les demande deux fois sans écho (une ligne depuis stdin
hors TTY), jamais en argument. `passwd` et `remove` révoquent les sessions.
Ne jamais commiter de mots de passe ; les tests génèrent leurs propres comptes.

Les mots de passe sont hashés avec scrypt asynchrone ; seuls les hashes SHA-256
des jetons de session sont stockés. `@fastify/cookie` lit et écrit le cookie
non signé HttpOnly, SameSite=Lax, qui expire après 30 jours et se renouvelle
lorsqu'il reste moins de 15 jours. `Secure`
est actif par défaut en production (`--production` ou `NODE_ENV=production`),
inactif en développement HTTP ; `COOKIE_SECURE=true/false` permet de le régler.
Un Origin dont l'hôte diffère de celui du site est refusé pour les mutations. Fastify ne
fait confiance qu'aux proxys loopback ; nginx remplace `X-Forwarded-For` par
`$remote_addr` et conserve le domaine public dans `Host` ou `X-Forwarded-Host`.
`@fastify/rate-limit` limite uniquement `POST /api/auth/login` à 10 requêtes par
IP (`request.ip`) sur 15 minutes, succès et requêtes invalides compris, sans
limite par identifiant. Les compteurs sont en mémoire et réinitialisés au
redémarrage ; un dépassement répond 429 avec un message en français.

Le frontend utilise React 19, React Router, Vite 8 et du CSS natif :

- `/` : affiches ou lignes compactes ; recherche dans titres, réalisateurs, résumés,
  commentaires et générique ; tous les tris et filtres sont dans l’URL et combinables.
  Les valeurs manquantes restent en fin de tri dans les deux sens. Les années de
  visionnage suivent Europe/Paris, comme les statistiques du serveur.
- `/film/:id` : notes du couple, moyenne et écart, métadonnées et
  générique ; édition, tags, enrichissement avec choix du candidat IMDb et
  suppression confirmée dans la page. Le retour conserve l’URL de la collection.
- `/ajouter` : recherche OMDb sur soumission uniquement, lien IMDb ou saisie manuelle,
  notes entières de 0 à 10, date, tags créables, résumé et commentaire.
  L’API de recherche ne fournit que les candidats : le synopsis et le générique
  apparaissent après l’enrichissement serveur, sauf résumé renseigné manuellement.
  Après l’ajout, la fiche vérifie temporairement l’avancement avec des GET locaux.
- `/stats` : indicateurs, années/mois, distributions par personne, classements,
  réalisateurs, genres, décennies, nuage IMDb à partir de 3 films comparables et
  taux d’enrichissement. SVG maison avec tableaux de données accessibles.
- `/renoter` (connexion requise) : films vus depuis au moins deux années calendaires UTC,
  proposés au hasard sans notes ni souvenirs personnels. Saisir les deux notes de mémoire
  révèle les originales et leur différence. Chaque film passe une seule fois ; « Ignorer »
  le retire et « Plus tard » le met de côté pour la session. La renote est visible sur
  la fiche (« Renoté le 20 nov. 2026 : … ») et annulable après confirmation inline, sans modifier les notes d’origine,
  moyennes, tris, filtres ou statistiques.
- `/connexion` : connexion, compte connecté et déconnexion. L'ajout redirige
  ici si nécessaire ; `?next=` permet de retrouver la page interne demandée.

L’interface française est conçue d’abord pour 390 px, avec navigation basse mobile,
navigation haute desktop et filtres en volet modal. Le thème suit les préférences
système ; le bouton soleil/lune conserve le choix dans `localStorage` quand disponible.
Les polices Google Fonts ont des fallbacks locaux ; les affiches absentes ou en
erreur deviennent des initiales sur une teinte dérivée du titre.
Les graphiques et commandes restent utilisables dans les deux thèmes, au clavier,
et avec la préférence de réduction des animations.

L’extension additive de `/api/stats` fournit `viewers[].rating_distribution` et
`imdb_pairs` (`id`, `title`, `avg`, `imdb_rating`) ; les champs existants sont conservés.

L'import conserve les annotations et les absences (`-` → `null`), ramène les notes
négatives à 0 et arrondit les scores au point le plus proche. Il lit uniquement
les notes de Fleur et Noé ; les colonnes F et I à L sont ignorées. Les dates Excel
sont interprétées en **Europe/Paris**, stockées en UTC ISO. La moyenne peut avoir
un demi-point ; l'écart est calculé si les deux notes existent. Le tag `+1 😭`
signifie « on a pleuré » et n'intervient dans aucun calcul. Réimporter remet les
champs issus du classeur à jour et conserve tags et enrichissement. Les tests
contrôlent les lignes du classeur et ses moyennes après normalisation des scores.

Hydrater d'abord en simulation, puis par petits lots lorsque souhaité :

```powershell
npm.cmd run hydrate -- --dry-run --limit 20
npm.cmd run hydrate -- --limit 20
npm.cmd run hydrate -- --id 42
npm.cmd run hydrate -- --refresh --limit 20
```

Sous Windows PowerShell, `npm.cmd` transmet correctement les options : le lanceur
`npm.ps1` peut supprimer le séparateur `--`. Dans les autres shells, `npm run hydrate -- …` convient.

Les films hydratés sont sautés sauf avec `--refresh`, qui réutilise les détails OMDb
en cache sans consommer de quota. Chaque lot affiche le nombre total de films
restant à vérifier. Un titre non résolu est marqué `needs_review` et
exclu des prochains lots ; choisir un IMDb via `PATCH /api/films/:id` (`imdb_id`
accepte aussi une URL IMDb), puis relancer avec `--id`. Les échecs partiels restent
reprenables. Ctrl+C termine l'opération courante puis ferme la base.

OMDb gratuit autorise 1 000 requêtes/jour ; le plafond local par défaut est **900**,
compté par jour civil à Paris. Chaque tentative réseau, même échouée, est journalisée
et réservée avant l'appel ; les réponses JSON sont conservées en base et réutilisées
sans consommer de quota. Les appels extérieurs à cette application ne sont pas comptés.
Le lot s'arrête proprement au budget. Wikidata utilise un User-Agent générique et les
affiches sont téléchargées localement, sans coût OMDb. L'ajout API déclenche une
hydratation en arrière-plan ; l'import Excel ne fait aucun appel réseau.
Wikidata fournit le titre original ; une ancienne valeur égale au titre OMDb est
considérée comme automatique et peut être corrigée. Une valeur manuelle différente
est conservée. L'affichage privilégie le titre original, puis le titre français en
petit s'il diffère ; les titres sans lettre latine passent en sous-titre.
Le synopsis personnel prime sur le synopsis français de Wikipédia, puis sur celui
d'OMDb en anglais. Wikipédia est mis en cache séparément, sans quota OMDb ; une
indisponibilité du synopsis français n'interrompt jamais l'enrichissement.

API publique : `GET /api/films`, `GET /api/films/:id`, `GET /api/tags`,
`GET /api/viewers`, `GET /api/stats`, `GET /api/auth/me` (utilisateur ou null),
ainsi que leurs variantes HEAD. `POST /api/auth/login` (`{username,password}`)
et `POST /api/auth/logout` sont accessibles sans session ; toutes les réponses
`/api/auth/*` portent `Cache-Control: no-store`.

API avec session : `GET /api/search?q=`, `GET /api/omdb/budget` (HEAD aussi),
`GET /api/rerate/next?exclude=1,2`, `POST /api/rerate/:id`
(`{"scores":{"1":8,"2":5}}`), `POST /api/rerate/:id/ignore`, `DELETE /api/rerate/:id`,
`POST /api/films`, `PATCH/DELETE /api/films/:id`,
`PUT /api/films/:id/ratings` (`{"ratings":[{"viewer_id":1,"score":8}]}`),
`PUT /api/films/:id/tags` (`{"tag_ids":[1]}`), `POST /api/films/:id/hydrate`,
`POST /api/tags`. Un unique hook `onRequest` installé par `registerAuth` protège par défaut
toute mutation `/api/*`, y compris future, sauf login/logout. Sans session valide,
il répond 401 ; un Origin présent dont l'hôte diffère répond 403.
La liste inclut notes, moyenne/écart, tags, crew et métadonnées
en un seul payload, sans les gros JSON bruts (disponibles sur la fiche).

Le schéma suit `PRAGMA user_version` ; `needs_review` stocke les résolutions à vérifier
et `api_log.raw_response` permet le cache durable prévu par le plan.
À l'ouverture, une base v1 migre automatiquement vers v2 dans une transaction :
suppression des spectateurs non core et de leurs notes, normalisation des scores,
contrainte entière 0–10, retrait de l'ancien lien externe et ajout de `plot_fr`.
La migration v3 ajoute `users` et `sessions`, sans modifier les films. Une base
neuve atteint le même schéma. La migration v4 ajoute `rerates` et `rerate_scores`
dans une transaction, sans modifier les données existantes. Les exports incluent
ces tables ; une version supérieure à 4 est refusée.
Le test du vrai classeur lit `data/source/filmsvus.xlsx` en lecture seule.

## Déploiement

Le [guide de déploiement](deploy/INSTALL.md) décrit l'installation sur Debian avec
nginx-site ≥ 1.1 : Node local au projet, systemd, données hors du checkout et
lecture publique et connexion applicative pour l'édition. Le hook retire
l'ancienne basic auth nginx ; les comptes se créent avec la CLI après l'import.
