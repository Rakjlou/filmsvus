# AGENTS.md — Films vus

Notes pour tout agent (Claude, Codex, autre) qui reprend ce projet. Le README décrit l'usage ; ce fichier décrit **comment travailler** et **ce qu'il faut savoir avant de toucher au code**.

## Méthode de travail : superviseur / implémenteur

Le propriétaire veut une répartition stricte des rôles :

- **Superviseur (Claude)** : il cadre la demande, découpe le travail en phases, rédige les consignes, relit les diffs, vérifie dans un vrai navigateur, commite. Il n'écrit pas lui-même le code applicatif, sauf pour une correction triviale de config (port, `.gitignore`…).
- **Implémenteur (Codex CLI ; à défaut, sous-agent Sonnet)** : il écrit le code et les tests, puis lance `typecheck`, `test` et `build`. **Il ne commite jamais.**

### Boucle par phase

1. Écrire la consigne dans un fichier temporaire, hors du repo (scratchpad). Elle doit être autonome : contexte, fichiers à lire d'abord (`docs/PLAN.md` et les modules concernés), périmètre précis, contraintes, tests attendus. Elle se termine par « run `npm run typecheck`, `npm test`, `npm run build`; do not commit; print a concise summary ».
2. Lancer Codex en arrière-plan :
   ```sh
   codex exec -s workspace-write -c sandbox_workspace_write.network_access=true - < consigne.md > codex.log 2>&1
   ```
3. Relire la fin du log et `git status` / `git diff`, puis relancer soi-même `npm test` et `npm run typecheck`.
4. **Vérifier visuellement** avec Chrome DevTools MCP, en mobile 390×844 puis en desktop 1440×900 : parcours réel, console, pas de scroll horizontal.
5. Lister les défauts constatés, les renvoyer à Codex dans une consigne ciblée, puis recommencer.
6. Avant chaque commit, chercher la clé OMDb dans le repo (voir *Secrets*). Commiter avec un message en français qui décrit la phase.

### Limites connues de l'implémenteur

- Sur cette machine, le bac à sable de Codex **ne peut ni lancer Chrome/Playwright ni écouter un port**. Les vérifications navigateur reviennent au superviseur. Inutile de demander à Codex une vérification visuelle.
- Codex a parfois laissé des dossiers temporaires dans le repo (`.npm-cache/`, `.browser-check/`). Les supprimer avant de commiter, et ne pas les ajouter au `.gitignore`.

## Projet en bref

Carnet des films vus par un couple (Fleur & Noé), importé de leur Google Sheet. C'est un MVP mobile-first, sans auth.

- **Stack** : Node 26 (≥ 24), ESM, TypeScript exécuté nativement par Node (pas de build serveur, syntaxe effaçable uniquement : pas d'`enum`, imports en `.ts`). Fastify 5, SQLite via `node:sqlite`, React 19 + Vite + React Router dans `web/`, CSS natif. Pas de lib de graphiques : SVG fait main.
- **Spécification validée** : `docs/PLAN.md`.
- **Arborescence** : `server/` (db, import, repo, routes, services), `scripts/` (dev, import-xlsx, hydrate), `web/` (pages, components), `tests/` (`node:test`, réseau entièrement simulé, fixtures dans `tests/fixtures/`).

### Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | API Fastify **:3210** + Vite **:4200** (ouvrir 4200). Vite recharge le front ; **relancer après toute modif serveur**. |
| `npm test` / `npm run typecheck` / `npm run build` | Doivent rester verts à chaque commit. |
| `npm run import:xlsx` | Import idempotent de `data/source/filmsvus.xlsx` (feuille `Liste`). |
| `npm run hydrate -- --limit N [--dry-run] [--id X]` | Enrichissement par lots. Saute les films déjà faits, s'arrête au budget. |

### Ports et environnement Windows

- **3000 est occupé par un service Windows (svchost) et 5141–5240 est réservé par Windows**, dont le 5173 de Vite. Les deux donnent `EACCES`. D'où le couple 3210 / 4200, à ne pas remettre par défaut.
- Démarrer les serveurs exige de sortir du bac à sable (le propriétaire a déjà accepté). Un ancien `npm run dev` peut survivre comme process `node` orphelin : vérifier avec `netstat -ano | grep 3210` avant de relancer. Arrêter un `npm run dev` lancé en tâche de fond ne tue que le wrapper : tuer aussi le PID node qui écoute (`taskkill //PID <pid> //T //F` sous Git Bash).
- Avec curl sous Git Bash, les accents sont mal encodés. Pour tester `/api/search`, encoder l'URL à la main (`Tir%C3%A9s`) ou passer par le navigateur.

## Données

- **392 films**. Notes **entières de 0 à 10** (Fleur, Noé), `-` correspond à `null` ; seule la moyenne du couple peut tomber sur un demi-point. Plus d'invités ni de Letterboxd dans l'outil (retirés le 12/11/2026 à la demande du propriétaire, migration v2 ; ces données restent dans le classeur source). Sauvegarde d'avant migration : `data/films.db.bak-20261112-avant-retours`.
- **Titres** : on affiche le titre original (Wikidata P1476) en gros et le titre français en petit s'il diffère ; si l'original n'a pas de lettre latine, c'est l'inverse. Le `Title` d'OMDb est le titre **anglais**, jamais l'original.
- **Tags purement cosmétiques**, par exemple `😭 +1` (« on a pleuré ») : ils n'entrent jamais dans un calcul.
- Dates Excel interprétées en Europe/Paris, stockées en UTC ISO.
- Hors git : `.env`, `data/films.db*`, `data/posters/`, `data/source/`, `dist/`. **Le repo n'a pas de remote** : la base n'existe que localement, le propriétaire en fait des copies lui-même.
- Le propriétaire ajoute des films lui-même via l'app : **ne jamais réimporter ni supprimer des données sans le lui demander.** Les films de test créés par un agent doivent être supprimés ensuite.

## Enrichissement (OMDb + Wikidata)

- **OMDb** (compte gratuit, 1000 req/jour) fournit les détails, les notes IMDb/Metascore/RT et l'affiche. Le budget est appliqué côté serveur (`OMDB_DAILY_BUDGET`, 900 par défaut), compté dans `api_log`. Les réponses sont mises en cache : une requête déjà faite ne coûte plus rien. Une hydratation coûte **1 seule requête OMDb** par film (par ID IMDb) ; `--refresh` re-hydrate des films déjà enrichis sans quota (cache).
- **Wikidata** (gratuit, sans clé) sert à deux choses :
  - la **recherche multilingue** (`/api/search`) : `wbsearchentities` en fr et en en, puis `wbgetentities`, en ne gardant que les éléments avec un ID IMDb `P345` en `tt…`. OMDb ne sert qu'en secours ou si on le force avec `?source=omdb`. OMDb ne connaît que les titres anglais, d'où ce choix ;
  - le **générique étendu**, via SPARQL : compositeur, chef op, monteur, producteurs, sociétés, titre original. La couverture est partielle (sociétés de production souvent absentes).
- **Résolution automatique** d'un film importé : recherche Wikidata sur le titre du tableur, scoring sur le titre, le réalisateur (colonne « Real ») et l'année (≤ année de visionnage). Si c'est ambigu, le film passe en `needs_review` et la fiche propose les candidats.
- **Wikidata limite le débit (429)** : on réessaie en respectant `Retry-After`, avec 1,5 s entre deux appels en lot. Si Wikidata échoue, l'hydratation s'arrête (erreur retryable) **sans se rabattre sur OMDb**, pour ne pas brûler le quota.
- Les affiches sont téléchargées dans `data/posters/<imdbId>.jpg`, ce qui ne consomme pas de quota.
- **Synopsis FR** : section « Synopsis/Résumé/Intrigue… » de l'article Wikipédia FR (lien via Wikidata), stockée dans `plot_fr`, cache `api_log` provider `wikipedia`. Best effort : un échec n'interrompt jamais l'hydratation. Priorité d'affichage : résumé perso > `plot_fr` > `plot_en`.

## Secrets

- La clé OMDb est **uniquement dans `.env`**, qui est ignoré par git. Ne jamais l'écrire dans un fichier suivi, un log commité, une consigne copiée dans le repo ou une requête vers un service tiers autre qu'OMDb.
- Avant chaque commit : `grep -rl "<clé>" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .` ne doit renvoyer que `./.env`.
- User-Agent des appels externes : `filmsvus-local/0.1`, sans aucune info personnelle.

## Conventions

- UI et messages de commit en français. Le code et les identifiants sont en anglais.
- Mobile first (390 px), cibles tactiles ≥ 44 px, thème sombre « salle obscure » par défaut avec un thème clair, accessibilité (labels, focus visibles, `prefers-reduced-motion`). Pas de `alert()` ni de `confirm()`.
- L'état de la liste (tri, filtres, vue) vit dans l'URL.
- Les modules réseau prennent un `fetch` injectable : les tests ne touchent jamais le vrai réseau.

## Pistes ouvertes

- **Hydratation faite le 12/11/2026** : 326 films enrichis sur 394, **68 en `needs_review`** (plusieurs candidats plausibles) à trancher par le propriétaire depuis la fiche. Wikidata a coupé une fois en cours de lot (429) : il suffit de relancer.
- Pas d'affiche dans les candidats venant de Wikidata (seulement des initiales).
- Sauvegarde de `data/films.db` (export ou remote) si le propriétaire le souhaite.
