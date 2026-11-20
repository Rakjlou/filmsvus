# Films vus — MVP « boosté » de filmsvus.xlsx

## Context
Le couple (Fleur & Noé) tient depuis 2018 un Google Sheet exporté en `filmsvus.xlsx` (feuille **Liste**, 391 films). Objectif : une app web Node moderne, mobile first, qui reprend la liste, la rend triable/filtrable de nombreuses façons, ajoute stats, formulaire d'ajout rapide, tags cosmétiques, affiches et infos enrichies (scénariste, compositeur, prod…). On construit le **support** de l'enrichissement ; l'hydratation complète des ~440 films se fera plus tard (quota OMDb gratuit = 1000 req/jour).

### Ce que contient la source (feuille Liste)
Colonnes : `Titre | Real | Date | Note Fleur | Note Noé | Note Moyenne | Résumé | Commentaire | Note Etienne | Letterboxd | Letterboxed note | Ecart`.
Pièges à gérer à l'import :
- Date = numéro de série Excel, parfois avec heure (`46326.49`) → ISO datetime (Europe/Paris).
- Notes sur 10, **négatives possibles** (-10, -3), `-` = non noté → `null`, décimales.
- Titre numérique (`1917.0` → `1917`) ; réal avec annotations (`Maïmouna Doucouré (pedo)`) gardé tel quel.
- Note Moyenne / Letterboxd note / Écart = **calculés**, pas importés (moyenne Fleur+Noé, /2 arrondi 0.5, |F−N|).
- Note Etienne (6 lignes) = notes d'invité → modèle « spectateurs » générique.
- Feuilles annexes (Stats, Script Test, Logs, Exploitation…) ignorées ; la feuille Logs révèle l'ancien Apps Script IMDb URL → OMDb, qu'on remplace.

## Décisions
- **Node 26, ESM, TypeScript** (un seul `package.json`), **Fastify 5** (API + sert le build), **SQLite via `node:sqlite`** (zéro dépendance native, Windows-friendly), **React + Vite** SPA, React Router.
- **OMDb** pour : recherche, ID IMDb, année, durée, genres, pays, langue, réal, scénaristes, acteurs, notes IMDb/Metascore/RT, awards, box-office, affiche.
- **Wikidata** (SPARQL, sans clé, via ID IMDb `P345`) pour : compositeur `P86`, chef op `P344`, monteur `P1040`, producteur `P162`, sociétés de prod `P272`, scénaristes `P58` (complément), titre FR (label fr).
- Clé OMDb dans `.env` (`OMDB_API_KEY=…`), `.env` gitignoré, `.env.example` commité. Appels OMDb **uniquement côté serveur**.
- Affiches **téléchargées localement** dans `data/posters/<imdbId>.jpg` à l'hydratation (ne coûte pas de quota OMDb, pas de hotlink fragile).
- `filmsvus.xlsx` déplacé dans `data/source/` (gitignoré, comme `data/*.db` et `data/posters/`) — données perso, rien de binaire dans git.

## Architecture
```
package.json            scripts: dev, build, start, import:xlsx, hydrate, test, typecheck
.env.example            OMDB_API_KEY=, OMDB_DAILY_BUDGET=900, PORT=3000, DB_PATH=data/films.db
server/
  index.ts              Fastify, /api/*, sert dist/ + /posters en prod
  db/schema.sql         migrations simples (user_version)
  db/index.ts           ouverture node:sqlite, migrate()
  repo/films.ts         CRUD films + ratings + tags + credits
  services/omdb.ts      client OMDb (search, byId), cache + budget quotidien
  services/wikidata.ts  requête SPARQL par imdbId → crew/companies
  services/hydrate.ts   hydrateFilm(id): OMDb → Wikidata → poster → upsert
  routes/{films,tags,viewers,stats,search}.ts
scripts/
  import-xlsx.ts        exceljs → DB (idempotent, clé = titre+date)
  hydrate.ts            CLI batch: --limit N --dry-run, saute les déjà hydratés, s'arrête au budget
web/
  main.tsx, routes: / (liste), /film/:id, /ajouter, /stats
  components: FilmCard, FilmRow, SortBar, FilterSheet, RatingInput, TagPicker, Poster
  styles: CSS natif (custom properties, clair/sombre), mobile first, breakpoints 640/1024
tests/                  node:test (import parsing, stats, omdb budget, routes via fastify.inject)
```

## Modèle de données (SQLite)
- `films` : id, title, title_fr, original_title, year, watched_at, director_text (colonne Real d'origine), summary, comment, imdb_id UNIQUE, letterboxd_url, runtime_min, genres (JSON), countries (JSON), languages (JSON), rated, imdb_rating, imdb_votes, metascore, rt_score, awards, box_office, poster_path, plot_en, omdb_raw, wikidata_raw, hydrated_at, created_at, updated_at.
- `viewers` : id, name, is_core (Fleur, Noé = core ; Etienne = invité). La moyenne/écart ne portent que sur les `is_core`.
- `ratings` : film_id, viewer_id, score REAL NULL (bornes -10..10), PK(film_id, viewer_id).
- `credits` : film_id, role (`director|writer|composer|cinematographer|editor|producer|actor`), name, position, source (`omdb|wikidata|manual`).
- `companies` : film_id, name, source.
- `tags` : id, label UNIQUE, emoji, color ; `film_tags` (film_id, tag_id). Seed : `+1 😭 on a pleuré`. Purement cosmétique, n'entre jamais dans un calcul de note.
- `api_log` : provider, request_key, status, at → compteur de budget OMDb du jour + cache des réponses brutes (une réponse déjà reçue ne se redemande jamais).

## Fonctionnalités
**Renoter** (`/renoter`, connexion requise, migration v4) : chaque film vu depuis au moins deux années calendaires UTC passe une seule fois dans une file aléatoire. La fiche masque notes du couple, moyenne, écart, résumé personnel, commentaire et tags ; les synopsis publics et notes externes restent visibles. Fleur et Noé saisissent chacun une note entière de 0 à 10 avant de découvrir les originaux et leur différence. On peut ignorer définitivement un film ou le remettre à plus tard pour la session. Les renotes sont affichées sur les fiches publiques, annulables après confirmation inline par un utilisateur connecté, et n’interviennent dans aucun calcul, tri ou filtre. Tables `rerates` (statut rated/ignored, date) et `rerate_scores` (deux notes), incluses dans l’export SQLite ; notes originales conservées.

1. **Liste** (`/`) : vue cartes avec affiche (fallback joli : initiales + couleur) et vue compacte ; état (tri, filtres, recherche, vue) dans l'URL.
   - **Tris** (asc/desc) : date de visionnage, titre, note moyenne, note Fleur, note Noé, écart, année de sortie, durée, note IMDb, Metascore, réalisateur, date d'ajout.
   - **Filtres** : recherche texte (titre, réal, résumé, commentaire, crew), tags, genre, réal, année vue, décennie de sortie, plage de note, « non noté », « non hydraté », désaccord ≥ N. Sur mobile : bottom sheet.
   - Tri/filtre côté client (≈450 lignes, `GET /api/films` renvoie tout en une fois, léger).
2. **Fiche film** (`/film/:id`) : affiche, notes Fleur/Noé/invités, moyenne, /5 Letterboxd, tags, résumé, commentaire, crew groupé par poste, sociétés de prod, infos OMDb ; édition inline ; bouton « Enrichir » (avec choix du candidat si pas d'ID IMDb) ; champ « coller une URL IMDb ».
3. **Ajouter** (`/ajouter`) : un champ titre + bouton Rechercher (1 requête OMDb `s=`, pas de recherche à chaque frappe) → candidats avec affiche → choix pré-remplit ; ou coller une URL IMDb ; ou saisie manuelle. Champs : notes Fleur & Noé (stepper -10..10 pas 0.5, gros boutons tactiles), date (défaut maintenant), tags (chips), commentaire, résumé (pré-rempli). Enregistrement → hydratation complète en tâche de fond.
4. **Stats** (`/stats`) : nb films, films/an et /mois, moyenne par personne et globale, distribution des notes (histogramme), plus grands désaccords, top/flop, réalisateurs les plus vus + leur moyenne, genres/décennies (si hydraté), corrélation note couple vs IMDb, taux d'hydratation. Graphiques en SVG maison (pas de lib lourde), lisibles clair/sombre.
5. **Hydratation** : `npm run hydrate -- --limit 50` ; résolution titre→IMDb par OMDb `t=` + année approchée, sinon marque `needs_review` pour choix manuel dans l'UI. Respect du budget quotidien (`OMDB_DAILY_BUDGET`), throttle ~1 req/s pour OMDb et Wikidata (User-Agent générique).

## API (extrait)
Renotes (session requise) : `GET /api/rerate/next?exclude=1,2`, `POST /api/rerate/:id` (`scores` indexé par identifiant des deux spectateurs core), `POST /api/rerate/:id/ignore`, `DELETE /api/rerate/:id`. La fiche publique `GET /api/films/:id` inclut `rerate` (date et comparaison des scores), ou null.

`GET/POST /api/films`, `GET/PATCH/DELETE /api/films/:id`, `PUT /api/films/:id/ratings`, `PUT /api/films/:id/tags`, `POST /api/films/:id/hydrate`, `GET /api/search?q=` (OMDb, compte au budget), `GET/POST /api/tags`, `GET /api/viewers`, `GET /api/stats`, `GET /api/omdb/budget`.

## Orchestration & commits
Je pilote, **Codex** (`codex exec`, CLI 0.167 présent) implémente phase par phase ; si Codex échoue/indisponible → sous-agent Sonnet. Après chaque phase : je relis le diff, lance typecheck/tests, vérifie dans Chrome (DevTools MCP, viewport mobile 390px puis desktop), puis commit.
1. Scaffold npm/TS/Fastify/Vite, `.gitignore`, `.env.example`, README court → commit.
2. Schéma DB + import xlsx (déplacement du fichier dans `data/source/`) + tests de parsing → commit.
3. API films/ratings/tags/stats + tests `fastify.inject` → commit.
4. Front : liste + tris/filtres + fiche film → commit.
5. Formulaire d'ajout + recherche OMDb → commit.
6. Services OMDb/Wikidata/posters + hydratation unitaire + CLI batch (test réel sur ~3 films seulement) → commit.
7. Page stats → commit.
8. Passe responsive/a11y finale → commit.

## Vérification
- `npm run import:xlsx` → 391 films, notes négatives et `-` correctes, `1917` bien titré, dates cohérentes (2018 → 2026), moyennes identiques à la colonne F du xlsx (contrôle automatisé dans les tests).
- `npm test` + `npm run typecheck` verts.
- `npm run hydrate -- --limit 3` → affiches locales, crew Wikidata (compositeur, chef op, prod) visibles sur la fiche, budget OMDb décrémenté de ~3–6.
- Chrome DevTools MCP : parcours mobile (390×844) et desktop — trier par écart, filtrer par tag `+1`, ajouter un film via recherche, vérifier qu'il apparaît en tête par date, page stats sans débordement horizontal, console sans erreur.
