# Films vus — le carnet de Fleur & Noé

Node **26.5** conseillé (minimum 24), npm, SQLite intégré à Node ; aucun serveur de base à installer.
Les fichiers TypeScript ESM sont exécutés directement par Node, sans compilation ni chargeur.

```powershell
npm install
# Si .env n'existe pas : Copy-Item .env.example .env
npm run import:xlsx
npm run dev
```

`npm run dev` lance Fastify sur `http://127.0.0.1:3000` et Vite sur
`http://127.0.0.1:5173` : ouvrir **l’adresse Vite**. Vite relaie `/api` et `/posters`
vers Fastify, sans CORS ni clé dans le navigateur. `PORT` règle le port de l’API,
`VITE_PORT` celui de Vite si les ports habituels sont occupés ou réservés.
Les deux serveurs tournent dans le même processus et se ferment ensemble avec Ctrl+C.
Vite recharge les changements du frontend ; relancer `dev` après une modification serveur.
La clé **OMDb reste dans `.env`**, chargé
par `--env-file-if-exists` ; renseigner `OMDB_API_KEY` si nécessaire. `.env.example`
ne contient aucune clé. `PORT`, `DB_PATH` et `OMDB_DAILY_BUDGET` sont configurables.
La source `data/source/filmsvus.xlsx` (feuille `Liste`), la base `data/films.db`,
les affiches `data/posters/` et `.env` sont ignorés par Git.

| Commande | Effet |
| --- | --- |
| `npm run dev` | API Fastify + Vite avec rechargement du frontend |
| `npm start` | API + SPA de `dist/` en production, sans surveillance |
| `npm run import:xlsx` | Import idempotent, clé titre + date ; résumé en sortie |
| `npm run hydrate -- --limit 20` | Enrichissement par lots, environ un appel/s |
| `npm test` | Tests `node:test`, SQLite temporaire, réseau entièrement simulé |
| `npm run typecheck` | Vérification TypeScript stricte du serveur, des scripts, tests et de `web/` |
| `npm run build` | Typecheck puis build Vite de la SPA dans `dist/` |

Pour la production : `npm run build`, puis `npm start`, et ouvrir l’adresse Fastify.
`start` active explicitement le service de `dist/` et le fallback SPA : un accès
direct à `/film/42`, `/ajouter` ou `/stats` fonctionne aussi après rechargement.
`/posters/*` sert les affiches locales dans les deux modes.

Le frontend utilise React 19, React Router, Vite 8 et du CSS natif, avec quatre pages :

- `/` : affiches ou lignes compactes ; recherche dans titres, réalisateurs, résumés,
  commentaires et générique ; tous les tris et filtres sont dans l’URL et combinables.
  Les valeurs manquantes restent en fin de tri dans les deux sens. Les années de
  visionnage suivent Europe/Paris, comme les statistiques du serveur.
- `/film/:id` : notes du couple et des invités, moyenne et écart, métadonnées et
  générique ; édition, tags, enrichissement avec choix du candidat IMDb et
  suppression confirmée dans la page. Le retour conserve l’URL de la collection.
- `/ajouter` : recherche OMDb sur soumission uniquement, lien IMDb ou saisie manuelle,
  notes de −10 à 10 par demi-point, date, tags créables, résumé et commentaire.
  L’API de recherche ne fournit que les candidats : le synopsis et le générique
  apparaissent après l’enrichissement serveur, sauf résumé renseigné manuellement.
  Après l’ajout, la fiche vérifie temporairement l’avancement avec des GET locaux.
- `/stats` : indicateurs, années/mois, distributions par personne, classements,
  réalisateurs, genres, décennies, nuage IMDb à partir de 3 films comparables et
  taux d’enrichissement. SVG maison avec tableaux de données accessibles.

L’interface française est conçue d’abord pour 390 px, avec navigation basse mobile,
navigation haute desktop et filtres en volet modal. Le thème suit les préférences
système ; le bouton soleil/lune conserve le choix dans `localStorage` quand disponible.
Les polices Google Fonts ont des fallbacks locaux ; les affiches absentes ou en
erreur deviennent des initiales sur une teinte dérivée du titre.
Les graphiques et commandes restent utilisables dans les deux thèmes, au clavier,
et avec la préférence de réduction des animations.

L’extension additive de `/api/stats` fournit `viewers[].rating_distribution` et
`imdb_pairs` (`id`, `title`, `avg`, `imdb_rating`) ; les champs existants sont conservés.

L'import conserve les annotations, les notes négatives et les absences (`-` → `null`).
Les dates Excel sont interprétées en **Europe/Paris**, stockées en UTC ISO. Les notes
calculées ignorent F/K/L et Etienne : moyenne des notes core disponibles, écart si
les deux existent, moyenne /2 arrondie au demi-point. Le tag `+1 😭` signifie
« on a pleuré » et n'intervient dans aucun calcul. Le texte non URL de J est ajouté
au commentaire. Réimporter remet les champs issus du classeur à jour et conserve
tags et enrichissement. Le classeur fourni contient **391 films**, **5 notes invité** ;
les tests contrôlent ses **390 moyennes** où Fleur et Noé ont tous deux une note.

Hydrater d'abord en simulation, puis par petits lots lorsque souhaité :

```powershell
npm.cmd run hydrate -- --dry-run --limit 20
npm.cmd run hydrate -- --limit 20
npm.cmd run hydrate -- --id 42
```

Sous Windows PowerShell, `npm.cmd` transmet correctement les options : le lanceur
`npm.ps1` peut supprimer le séparateur `--`. Dans les autres shells, `npm run hydrate -- …` convient.

Les films hydratés sont sautés. Un titre non résolu est marqué `needs_review` et
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

API : `GET/POST /api/films`, `GET/PATCH/DELETE /api/films/:id`,
`PUT /api/films/:id/ratings` (`{"ratings":[{"viewer_id":1,"score":8}]}`),
`PUT /api/films/:id/tags` (`{"tag_ids":[1]}`), `POST /api/films/:id/hydrate`,
`GET /api/search?q=`, `GET/POST /api/tags`, `GET /api/viewers`, `GET /api/stats`,
`GET /api/omdb/budget`. La liste inclut notes, moyenne/écart, tags, crew et métadonnées
en un seul payload, sans les gros JSON bruts (disponibles sur la fiche).

Le schéma suit `PRAGMA user_version` ; `needs_review` stocke les résolutions à vérifier
et `api_log.raw_response` permet le cache durable prévu par le plan.
