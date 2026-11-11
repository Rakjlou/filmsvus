import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDb, tempDir, offline, json } from './helpers.ts';
import { buildApp } from '../server/index.ts';
import { FilmsRepo } from '../server/repo/films.ts';

test('API films : CRUD, notes core/invité, tags, payload liste complet et cascade', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db);
  const app = buildApp({ db, fetch: offline, backgroundHydration: false, postersDir: tempDir(t) });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/viewers')).json().length, 3);
  assert.equal((await app.inject('/api/tags')).json()[0].label, '+1');
  const create = await app.inject({ method: 'POST', url: '/api/films', payload: {
    title: 'Mon film', watched_at: '2026-11-11T12:00:00Z', director_text: 'Réalisatrice',
    summary: 'Résumé', comment: 'Commentaire', genres: ['Drama'], year: 2000, runtime_min: 90,
    letterboxd_url: 'https://letterboxd.com/film/test/',
    imdb_id: 'https://www.imdb.com/title/tt1234567/?ref_=abc',
    ratings: [{ viewer_id: 1, score: 8 }, { viewer_id: 2, score: 5 }, { viewer_id: 3, score: -10 }],
    tag_ids: [1], credits: [{ role: 'composer', name: 'Musicien', position: 0, source: 'manual' }],
  } });
  assert.equal(create.statusCode, 201, create.body);
  const film = create.json(), url = `/api/films/${film.id}`;
  assert.equal(create.headers.location, url);
  assert.equal(film.imdb_id, 'tt1234567'); assert.equal(film.avg, 6.5); assert.equal(film.gap, 3);
  assert.equal(film.letterboxd_rating, 3.5); assert.equal(film.core_ratings.length, 2);
  assert.equal(film.guest_ratings[0].score, -10); assert.equal(film.tags.length, 1);
  repo.patch(film.id, { imdb_rating: 8, poster_path: 'tt1234567.jpg', hydrated_at: '2026-11-11T13:00:00Z',
    omdb_raw: '{"private":"large"}', wikidata_raw: '{"private":"large"}' });
  const list = (await app.inject('/api/films')).json();
  assert.equal(list.length, 1); assert.equal(list[0].poster_url, '/posters/tt1234567.jpg');
  assert.equal(list[0].hydrated, true); assert.equal(list[0].imdb_rating, 8);
  assert.equal(list[0].year, 2000); assert.equal(list[0].runtime_min, 90);
  assert.deepEqual(list[0].genres, ['Drama']); assert.equal(list[0].credits[0].name, 'Musicien');
  assert.equal(list[0].omdb_raw, undefined); assert.equal(list[0].wikidata_raw, undefined);
  const get = await app.inject(url); assert.equal(get.statusCode, 200);
  assert.ok(get.json().omdb_raw);
  const patch = await app.inject({ method: 'PATCH', url, payload: { comment: 'Modifié', year: 2001 } });
  assert.equal(patch.statusCode, 200); assert.equal(patch.json().comment, 'Modifié');
  const ratings = await app.inject({ method: 'PUT', url: `${url}/ratings`, payload: { ratings: [{ viewer_id: 1, score: null }] } });
  assert.equal(ratings.statusCode, 200); assert.equal(ratings.json().avg, 5); assert.equal(ratings.json().gap, null);
  const tag = await app.inject({ method: 'POST', url: '/api/tags', payload: { label: 'Soirée', emoji: '🎬', color: '#123abc' } });
  assert.equal(tag.statusCode, 201, tag.body);
  assert.equal((await app.inject({ method: 'PUT', url: `${url}/tags`, payload: { tag_ids: [tag.json().id] } })).statusCode, 200);
  const stats = (await app.inject('/api/stats')).json(); assert.equal(stats.total, 1); assert.equal(stats.avg, 5);
  assert.equal(stats.hydrated, 1);
  assert.equal((await app.inject({ method: 'DELETE', url })).statusCode, 204);
  assert.equal((await app.inject(url)).statusCode, 404);
  for (const table of ['ratings', 'credits', 'companies', 'film_tags']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
});

test('API : schémas JSON, références, conflits, IMDb invalide et mise à jour atomique', async t => {
  const db = tempDb(t);
  const app = buildApp({ db, fetch: offline, backgroundHydration: false, postersDir: tempDir(t) });
  t.after(() => app.close());
  for (const payload of [{}, { title: '' }, { title: '  ' }, { title: 'X', unexpected: true },
    { title: 'X', watched_at: '2026-02-30' }, { title: 'X', year: 'nonsense' },
    { title: 'X', imdb_id: 'https://evil.example/title/tt1234567/' },
    { title: 'X', letterboxd_url: 'javascript:alert(1)' },
    { title: 'X', ratings: [{ viewer_id: 1, score: 10.1 }] },
    { title: 'X', ratings: [{ viewer_id: 999, score: 3 }] },
    { title: 'X', tag_ids: [999] },
    { title: 'X', credits: [{ role: 'composer', name: 'X', position: 0, source: 'wikidata' }] }]) {
    const response = await app.inject({ method: 'POST', url: '/api/films', payload });
    assert.equal(response.statusCode, 400, `${JSON.stringify(payload)} : ${response.body}`);
  }
  assert.deepEqual((await app.inject('/api/films')).json(), []);
  const valid = { title: 'Film', watched_at: '2026-11-11T12:00:00Z', ratings: [{ viewer_id: 1, score: 5 }], tag_ids: [1] };
  const film = (await app.inject({ method: 'POST', url: '/api/films', payload: valid })).json();
  assert.equal((await app.inject({ method: 'POST', url: '/api/films', payload: valid })).statusCode, 409);
  const fail = await app.inject({ method: 'PATCH', url: `/api/films/${film.id}`, payload: { title: 'Modifié', tag_ids: [999] } });
  assert.equal(fail.statusCode, 400);
  const unchanged = (await app.inject(`/api/films/${film.id}`)).json();
  assert.equal(unchanged.title, 'Film'); assert.equal(unchanged.tags[0].id, 1);
  assert.equal((await app.inject('/api/films/nope')).statusCode, 400);
  assert.equal((await app.inject('/api/films/0')).statusCode, 400);
  assert.equal((await app.inject('/api/films/999')).statusCode, 404);
  for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
    const url = method === 'PUT' ? '/api/films/999/ratings' : '/api/films/999';
    const payload = method === 'PATCH' ? { title: 'X' } : method === 'PUT' ? { ratings: [] } : undefined;
    assert.equal((await app.inject({ method, url, payload })).statusCode, 404);
  }
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/films/${film.id}`, payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: `/api/films/${film.id}/tags`, payload: { tag_ids: [1, 1] } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/tags', payload: { label: '+1' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/api/tags', payload: { label: 'X', color: 'red' } })).statusCode, 400);
});

test('API recherche/budget/hydratation : fetch simulé, cache, quota HTTP 429, revue manuelle', async t => {
  const db = tempDb(t); let calls = 0;
  const fetch: typeof globalThis.fetch = async input => {
    calls++;
    const url = new URL(String(input));
    if (url.searchParams.has('s')) return json({ Response: 'True', Search: [{ Title: 'Film', imdbID: 'tt1234567' }] });
    return json({ Response: 'False', Error: 'Movie not found!' });
  };
  const app = buildApp({ db, fetch, apiKey: 'test-secret', dailyBudget: 2, throttleMs: 0, backgroundHydration: false, postersDir: tempDir(t) });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/search')).statusCode, 400);
  assert.equal((await app.inject('/api/search?q=%20%20')).statusCode, 400);
  assert.equal((await app.inject('/api/search?q=Film')).json().Search.length, 1);
  await app.inject('/api/search?q=Film'); assert.equal(calls, 1);
  const film = new FilmsRepo(db).create({ title: 'Inconnu' });
  const hydrated = await app.inject({ method: 'POST', url: `/api/films/${film.id}/hydrate` });
  assert.equal(hydrated.statusCode, 200); assert.equal(hydrated.json().needs_review, true);
  const budget = (await app.inject('/api/omdb/budget')).json();
  assert.equal(budget.used, 2); assert.equal(budget.remaining, 0); assert.equal(budget.timezone, 'Europe/Paris');
  const exhausted = await app.inject('/api/search?q=Autre');
  assert.equal(exhausted.statusCode, 429); assert.equal(exhausted.json().error, 'BudgetExceeded');
  assert.ok(!exhausted.body.includes('test-secret')); assert.equal(calls, 2);
});

test('changement IMDb : métadonnées et hydratation invalidées, souvenirs et crédits manuels préservés', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db);
  const film = repo.create({ title: 'Film', imdb_id: 'tt1234567', summary: 'Souvenir', year: 1999,
    hydrated_at: '2026-11-11T12:00:00Z', imdb_rating: 8, genres: ['Drama'],
    credits: [{ role: 'director', name: 'Manuel', position: 0, source: 'manual' }, { role: 'writer', name: 'Auto', position: 0, source: 'omdb' }],
    companies: [{ name: 'Auto', source: 'wikidata' }] });
  const updated = repo.patch(film.id, { imdb_id: 'tt7654321' });
  assert.equal(updated.hydrated, false); assert.equal(updated.year, null);
  assert.equal(updated.imdb_rating, null); assert.deepEqual(updated.genres, []);
  assert.equal(updated.summary, 'Souvenir'); assert.equal(updated.credits.length, 1);
  assert.deepEqual(updated.companies, []);
});

test('API ajout : hydratation en arrière-plan et attente propre à la fermeture', async t => {
  const db = tempDb(t); let calls = 0;
  const app = buildApp({ db, apiKey: 'test', throttleMs: 0, postersDir: tempDir(t),
    fetch: async () => { calls++; return json({ Response: 'False', Error: 'Movie not found!' }); } });
  const response = await app.inject({ method: 'POST', url: '/api/films', payload: { title: 'Introuvable' } });
  assert.equal(response.statusCode, 201);
  await app.close();
  assert.equal(calls, 1); assert.equal(new FilmsRepo(db).get(response.json().id).needs_review, true);
});

test('fichiers statiques : affiches locales, build prod, fallback SPA et 404 API/assets', async t => {
  const db = tempDb(t), directory = tempDir(t), posters = join(directory, 'posters'), dist = join(directory, 'dist');
  mkdirSync(posters); mkdirSync(dist);
  writeFileSync(join(posters, 'tt1234567.jpg'), new Uint8Array([255, 216, 255, 217]));
  writeFileSync(join(dist, 'index.html'), '<html><body>Films vus</body></html>');
  writeFileSync(join(dist, 'app.js'), 'console.log("SPA");');
  const app = buildApp({ db, fetch: offline, backgroundHydration: false, production: true, postersDir: posters, distDir: dist });
  t.after(() => app.close());
  const poster = await app.inject('/posters/tt1234567.jpg');
  assert.equal(poster.statusCode, 200); assert.equal(poster.headers['content-type'], 'image/jpeg');
  assert.equal((await app.inject('/app.js')).statusCode, 200);
  const fallback = await app.inject('/film/12'); assert.equal(fallback.statusCode, 200); assert.ok(fallback.body.includes('Films vus'));
  assert.equal((await app.inject('/api/inexistant')).statusCode, 404);
  assert.equal((await app.inject('/posters/manquant.jpg')).statusCode, 404);
  assert.equal((await app.inject('/manquant.js')).statusCode, 404);
  assert.equal((await app.inject('/posters/%2e%2e/package.json')).statusCode, 404);
});
