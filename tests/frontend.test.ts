import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilmsRepo } from '../server/repo/films.ts';
import { tempDb } from './helpers.ts';
import { selectFilms, sorts } from '../web/listState.ts';
import { posterInitials } from '../web/format.ts';
import { stepRating } from '../web/rating.ts';
import { displayTitles } from '../web/titles.ts';
import { candidateSelection, normalizeCandidate } from '../web/search.ts';
import { dansMaPeau, knivesOut } from './fixtures/wikidata.ts';
import { safeNext } from '../web/authNavigation.ts';
import { api, json, message } from '../web/api.ts';
import { parseRerateExclusions, rerateCount, rerateDate, rerateDelta, rerateSynopsisOverflows } from '../web/rerate.ts';
import { ReratesRepo } from '../server/repo/rerates.ts';

test('renote : bouton du synopsis selon les lignes rendues, avec tolérance aux arrondis', () => {
  assert.equal(rerateSynopsisOverflows(27, 26.75), false);
  assert.equal(rerateSynopsisOverflows(107, 26.75), false);
  assert.equal(rerateSynopsisOverflows(108, 26.75), false);
  assert.equal(rerateSynopsisOverflows(134, 26.75), true);
  // The full scroll height remains measurable while clamped or expanded;
  // wrapping onto fewer lines after a resize removes the toggle.
  assert.equal(rerateSynopsisOverflows(535, 26.75), true);
  assert.equal(rerateSynopsisOverflows(80, 26.75), false);
});

test('connexion : retour interne uniquement, y compris URLs trompeuses', () => {
  for (const path of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/\n/evil.example']) assert.equal(safeNext(path), '/');
  for (const path of ['/ajouter', '/film/42?x=1#notes', '/?sort=title&dir=asc']) assert.equal(safeNext(path), path);
});

test('renote : différences, date française, pluriels et exclusions de session', () => {
  assert.deepEqual([null, 0, 1, -2, 10, -10].map(rerateDelta), ['—', '=', '+1', '−2', '+10', '−10']);
  assert.equal(rerateDate('2026-11-20T12:00:00Z'), '20/11/2026');
  assert.deepEqual([0, 1, 2].map(rerateCount), ['0 film à renoter', '1 film à renoter', '2 films à renoter']);
  for (const input of [null, '', 'invalid', '{}', 'null']) assert.deepEqual(parseRerateExclusions(input), []);
  assert.deepEqual(parseRerateExclusions('[1,2,1,0,-1,1.5,"3",null]'), [1, 2]);
  assert.equal(parseRerateExclusions(JSON.stringify(Array.from({ length: 501 }, (_, i) => i + 1))).length, 500);
});

test('renote : tri, filtres et calculs de la collection restent fondés sur les originaux', t => {
  const repo = new FilmsRepo(tempDb(t));
  const film = repo.create({ title: 'Renoté', watched_at: '2020-01-01T00:00:00Z',
    ratings: [{ viewer_id: 1, score: 2 }, { viewer_id: 2, score: 4 }] });
  repo.create({ title: 'Autre', watched_at: '2020-02-01T00:00:00Z', ratings: [{ viewer_id: 1, score: 7 }, { viewer_id: 2, score: 9 }] });
  const params = [new URLSearchParams('sort=avg&dir=desc'), new URLSearchParams('max=4'), new URLSearchParams('gap=2')];
  const before = params.map(p => selectFilms(repo.list(), p).map(f => [f.id, f.avg, f.gap]));
  new ReratesRepo(repo, () => Date.parse('2026-11-20T12:00:00Z')).rate(film.id, { 1: 10, 2: 10 });
  assert.deepEqual(params.map(p => selectFilms(repo.list(), p).map(f => [f.id, f.avg, f.gap])), before);
});

test('client API : 401 invalide la session, erreur française et message 429 de connexion conservé', async t => {
  const previousFetch = globalThis.fetch, previousWindow = globalThis.window;
  const events = new EventTarget();
  globalThis.window = events as unknown as Window & typeof globalThis;
  t.after(() => { globalThis.fetch = previousFetch; globalThis.window = previousWindow; });
  let expired = 0;
  events.addEventListener('filmsvus-session-expired', () => expired++);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Unauthorized', message: 'Connexion requise' }), { status: 401 });
  await assert.rejects(api('/films/1', json('PATCH', { comment: 'Souvenir' })), /Votre session a expiré, reconnectez-vous/);
  assert.equal(expired, 1);
  await assert.rejects(api('/auth/login', json('POST', { username: 'test', password: 'incorrect' })), /Connexion requise/);
  assert.equal(expired, 1);
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' }), { status: 429 });
  await assert.rejects(api('/auth/login', json('POST', {})), /15 minutes/);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'BudgetExceeded', message: 'Budget OMDb quotidien atteint' }), { status: 429 });
  await assert.rejects(api('/search?q=Film'), /budget OMDb du jour/);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Validation', message: 'body must have required property' }), { status: 400 });
  await assert.rejects(api('/auth/login', json('POST', {})), /identifiant et votre mot de passe/);
  await assert.rejects(api('/films', json('POST', {})), /Vérifiez les champs/);
  assert.equal(message(new Error('Erreur')), 'Erreur');
});

test('renote : le client conserve le message de conflit et signale les erreurs réseau en français', async t => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'RerateConflict', message: 'Ce film a déjà été renoté. Passez au film suivant.' }), { status: 409 });
  await assert.rejects(api('/rerate/1', json('POST', { scores: { 1: 8, 2: 5 } })), /déjà été renoté/);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(api('/rerate/next'), /Impossible de joindre le serveur/);
});

test('titres affichés : original latin, français discret, original non latin et normalisation', () => {
  for (const [film, expected] of [
    [{ title: 'An Ordinary Case', title_fr: 'Le Fil', original_title: 'Le Fil' }, { main: 'Le Fil', secondary: null }],
    [{ title: 'Dans ma peau', title_fr: 'Dans ma peau', original_title: 'In My Skin' }, { main: 'In My Skin', secondary: 'Dans ma peau' }],
    [{ title: 'Parasite', title_fr: 'Parasite', original_title: '기생충' }, { main: 'Parasite', secondary: '기생충' }],
    [{ title: 'Titre seul' }, { main: 'Titre seul', secondary: null }],
    [{ title: 'Another English title', title_fr: 'À couteaux-tirés !', original_title: 'A COUTEAUX TIRES' }, { main: 'A COUTEAUX TIRES', secondary: null }],
    [{ title: 'Film anglais', title_fr: 'Film français', original_title: 'Фильм' }, { main: 'Film français', secondary: 'Фильм' }],
    [{ title: 'Autre titre', original_title: 'Original' }, { main: 'Original', secondary: 'Autre titre' }],
  ] as const) assert.deepEqual(displayTitles(film), expected);
});

test('tri des titres : utilise le titre affiché et recherche toujours les trois titres', t => {
  const repo = new FilmsRepo(tempDb(t));
  const first = repo.create({ title: 'Zulu', original_title: 'Alpha', title_fr: 'Premier' });
  const second = repo.create({ title: 'Bravo', original_title: '기생충', title_fr: 'Parasite' });
  assert.deepEqual(selectFilms(repo.list(), new URLSearchParams('sort=title&dir=asc')).map(f => f.id), [first.id, second.id]);
  assert.deepEqual(selectFilms(repo.list(), new URLSearchParams('sort=title&dir=desc')).map(f => f.id), [second.id, first.id]);
  for (const q of ['Zulu', 'Alpha', 'Premier']) assert.deepEqual(selectFilms(repo.list(), new URLSearchParams({ q })).map(f => f.id), [first.id]);
});

test('affiches : initiales sans ponctuation, parenthèses ni mots purement numériques', () => {
  for (const [title, expected] of [
    ['Malveillante (Other Mommy)', 'MO'], ['[Été] — à Paris', 'ÉÀ'],
    ['... 123 (45) Blade Runner 2049', 'BR'], ['District 9', 'D'],
    ['B2 Plan', 'BP'], ['1917', 'FV'], [' ( [] ) — ', 'FV'], ['', 'FV'],
  ] as const) assert.equal(posterInitials(title), expected, title);
});

test('notes : premier pas à 5 dans les deux sens, points entiers, zéro et bornes préservés', () => {
  assert.equal(stepRating(null, 1), 5);
  assert.equal(stepRating(null, -1), 5);
  assert.equal(stepRating(5, 1), 6);
  assert.equal(stepRating(5, -1), 4);
  assert.equal(stepRating(0, -1), 0);
  assert.equal(stepRating(0, 1), 1);
  assert.equal(stepRating(10, 1), 10);
});

test('candidats : compatibilité OMDb et sélection en français conservant la casse saisie', () => {
  const legacy = normalizeCandidate({ imdbID: 'tt1234567', Title: 'Film', Year: '1999', Poster: 'N/A', Director: 'Alice, Bob' });
  assert.equal(legacy.title, 'Film'); assert.equal(legacy.year, 1999); assert.equal(legacy.poster, null);
  assert.deepEqual(legacy.directors, ['Alice', 'Bob']);
  const candidate = { imdbID: dansMaPeau.imdbID, title: dansMaPeau.titleFr!, originalTitle: dansMaPeau.originalTitle,
    englishTitle: dansMaPeau.titleEn, year: dansMaPeau.year, directors: dansMaPeau.directors, poster: null, source: 'wikidata' as const };
  assert.equal(candidateSelection(candidate, ' DANS MA PEAU ').title, 'DANS MA PEAU');
  assert.equal(candidateSelection(candidate, 'In My Skin').title, 'Dans ma peau');
  assert.equal(candidateSelection({ ...candidate, title: knivesOut.titleFr! }, 'A Couteaux Tirés').title, 'À couteaux tirés');
});

test('liste : recherche accent-insensible dans les souvenirs et le générique, filtres combinés, année Paris', t => {
  const repo = new FilmsRepo(tempDb(t));
  const film = repo.create({ title: 'Été', title_fr: 'Un été français', original_title: 'Summer in Paris', watched_at: '2025-12-31T23:30:00Z', director_text: 'Agnès Varda',
    summary: 'Une plage', comment: 'Mémorable', year: 1999, genres: ['Drame'], tag_ids: [1],
    credits: [{ role: 'composer', name: 'Éric Serra', position: 0, source: 'manual' }],
    ratings: [{ viewer_id: 1, score: 0 }, { viewer_id: 2, score: 6 }] });
  repo.create({ title: 'Autre', watched_at: '2025-01-01T00:00:00Z', hydrated_at: '2025-02-01T00:00:00Z' });
  const films = repo.list();
  for (const q of ['ete', 'francais', 'summer', 'agnes', 'plage', 'memorable', 'eric']) assert.deepEqual(selectFilms(films, new URLSearchParams({ q })).map(f => f.id), [film.id]);
  const params = new URLSearchParams({ year: '2026', decade: '1990', tag: '1', genre: 'Drame', director: 'Agnès Varda', min: '3', max: '3', gap: '6', unhydrated: '1' });
  assert.deepEqual(selectFilms(films, params).map(f => f.id), [film.id]);
  params.set('min', '3.5'); assert.equal(selectFilms(films, params).length, 0);
  assert.equal(selectFilms(films, new URLSearchParams('unrated=1')).length, 1);
  assert.equal(selectFilms(films, new URLSearchParams('max=-1')).length, 0);
  assert.equal(selectFilms(films, new URLSearchParams('gap=11')).length, 0);
});

test('liste : recherches répétées sur les mêmes films, accents et objets remplacés', t => {
  const repo = new FilmsRepo(tempDb(t));
  const film = repo.create({ title: 'Été', comment: 'Mémorable', credits: [{ role: 'composer', name: 'Éric Serra', position: 0, source: 'manual' }] });
  repo.create({ title: 'Autre' });
  const films = repo.list(), original = films.map(f => f.id);
  for (let pass = 0; pass < 3; pass++) {
    for (const q of ['ete', 'ÉTÉ', 'memorable', 'MÉMORABLE', 'eric', 'ÉRIC']) {
      assert.deepEqual(selectFilms(films, new URLSearchParams({ q })).map(f => f.id), [film.id]);
    }
    assert.equal(selectFilms(films, new URLSearchParams('q=absent')).length, 0);
  }
  const edited = films.map(f => f.id === film.id ? { ...f, title: 'Forêt' } : f);
  assert.deepEqual(selectFilms(edited, new URLSearchParams('q=foret')).map(f => f.id), [film.id]);
  assert.equal(selectFilms(edited, new URLSearchParams('q=ete')).length, 0);
  assert.deepEqual(films.map(f => f.id), original);
});

test('liste : tous les tris, notes entières, absences en dernier dans les deux sens, entrée préservée', t => {
  const repo = new FilmsRepo(tempDb(t));
  const first = repo.create({ title: 'A', watched_at: '2024-01-01T00:00:00Z', director_text: 'A', year: 1990,
    runtime_min: 90, imdb_rating: 3, metascore: 20, ratings: [{ viewer_id: 1, score: 0 }, { viewer_id: 2, score: 2 }] });
  const second = repo.create({ title: 'B', watched_at: '2025-01-01T00:00:00Z', director_text: 'B', year: 2000,
    runtime_min: 120, imdb_rating: 8, metascore: 90, ratings: [{ viewer_id: 1, score: 4 }, { viewer_id: 2, score: 8 }] });
  repo.db.prepare('UPDATE films SET created_at=? WHERE id=?').run('2024-01-01T00:00:00Z', first.id);
  repo.db.prepare('UPDATE films SET created_at=? WHERE id=?').run('2025-01-01T00:00:00Z', second.id);
  repo.create({ title: 'Z', watched_at: '2026-01-01T00:00:00Z' });
  const films = repo.list(), original = films.map(f => f.id);
  for (const [sort] of sorts) {
    const ascending = selectFilms(films, new URLSearchParams({ sort, dir: 'asc' }));
    const descending = selectFilms(films, new URLSearchParams({ sort, dir: 'desc' }));
    assert.equal(ascending[0]!.id, first.id, sort);
    assert.ok(descending.findIndex(f => f.id === second.id) < descending.findIndex(f => f.id === first.id), sort);
    if (!['title', 'watched_at', 'created_at'].includes(sort)) assert.equal(descending.at(-1)!.title, 'Z', sort);
  }
  assert.deepEqual(films.map(f => f.id), original);
  assert.equal(selectFilms(films, new URLSearchParams('sort=unknown&dir=broken'))[0]!.title, 'Z');
});
