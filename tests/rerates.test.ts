import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp } from './helpers.ts';
import { rerateCutoff } from '../server/repo/rerates.ts';

const now = () => Date.parse('2026-11-20T12:00:00Z');

test('renote : les quatre endpoints et HEAD exigent une session avant toute validation', async t => {
  const { app, authed } = testApp(t, { now });
  for (const [method, url] of [
    ['GET', '/api/rerate/next'], ['HEAD', '/api/rerate/next'],
    ['POST', '/api/rerate/1'], ['POST', '/api/rerate/1/ignore'], ['DELETE', '/api/rerate/1'],
  ] as const) {
    const response = await app.inject({ method, url });
    assert.equal(response.statusCode, 401, `${method} ${response.body}`);
    if (method !== 'HEAD') assert.equal(response.json().message, 'Connexion requise');
  }
  for (const [method, url, payload] of [
    ['POST', '/api/rerate/1', { scores: { 1: 8, 2: 5 } }],
    ['POST', '/api/rerate/1/ignore', undefined], ['DELETE', '/api/rerate/1', undefined],
  ] as const) {
    assert.equal((await authed({ method, url, payload, headers: { origin: 'https://other.example' } })).statusCode, 403);
  }
});

test('renote : seuil UTC contrôlé, notes nulles, exclusions et payload aveugle limité aux champs autorisés', async t => {
  const { repo, authed } = testApp(t, { now });
  const old = repo.create({ title: 'Ancien', watched_at: '2024-11-19T12:00:00Z', summary: 'Secret', comment: 'Secret aussi', tag_ids: [1],
    ratings: [{ viewer_id: 1, score: 7 }, { viewer_id: 2, score: 7 }],
    plot_fr: 'Synopsis public', imdb_rating: 9, metascore: 85, rt_score: 90,
    credits: [{ name: 'Actrice', role: 'actor', position: 0, source: 'manual' }] });
  const boundary = repo.create({ title: 'Exactement deux ans, sans notes', watched_at: '2024-11-20T12:00:00Z' });
  repo.create({ title: 'Récent', watched_at: '2024-11-21T12:00:00Z' });
  repo.create({ title: 'Une milliseconde trop tôt', watched_at: '2024-11-20T12:00:00.001Z' });
  let response = await authed({ url: `/api/rerate/next?exclude=${boundary.id}` });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  const result = response.json();
  assert.equal(result.remaining, 2); assert.equal(result.film.id, old.id);
  assert.deepEqual(Object.keys(result.film).sort(), [
    'id', 'title', 'title_fr', 'original_title', 'year', 'watched_at', 'director_text', 'credits', 'runtime_min', 'genres', 'countries',
    'poster_url', 'plot_fr', 'plot_en', 'imdb_rating', 'metascore', 'rt_score',
  ].sort());
  for (const key of ['ratings', 'core_ratings', 'avg', 'average', 'gap', 'summary', 'comment', 'tags', 'rerate', 'omdb_raw', 'wikidata_raw']) {
    assert.equal(Object.hasOwn(result.film, key), false, key);
  }
  assert.equal(result.film.plot_fr, 'Synopsis public'); assert.equal(result.film.imdb_rating, 9);
  response = await authed({ url: `/api/rerate/next?exclude=${old.id}` });
  assert.equal(response.json().film.id, boundary.id);
  response = await authed({ url: `/api/rerate/next?exclude=${old.id},${boundary.id}` });
  assert.deepEqual(response.json(), { remaining: 2, film: null });
  for (const exclude of ['', '0', '-1', '1.5', 'x', '1,,2', '1,', '01', '9007199254740992', Array(501).fill('1').join(',')]) {
    const bad = await authed({ url: `/api/rerate/next?exclude=${encodeURIComponent(exclude)}` });
    assert.equal(bad.statusCode, 400, `${exclude.slice(0, 30)}: ${bad.body}`);
  }
  assert.equal((await authed({ url: '/api/rerate/next?unexpected=1' })).statusCode, 400);
});

test('renote : validation stricte des deux core et transaction atomique', async t => {
  const { db, repo, authed } = testApp(t, { now });
  const film = repo.create({ title: 'Validation', watched_at: '2020-01-01T00:00:00Z' });
  db.exec("INSERT INTO viewers(id,name,is_core) VALUES (3,'Autre',0)");
  for (const scores of [{}, { 1: 5 }, { 1: 5, 3: 7 }, { 1: 5, 2: 7, 3: 8 }, { 1: 5, 999: 8 },
    { 1: 1.5, 2: 5 }, { 1: -1, 2: 5 }, { 1: 11, 2: 5 }, { 1: null, 2: 5 }, { 1: '8', 2: 5 },
    { 1: true, 2: 5 }, [8, 5], { '01': 8, 2: 5 }]) {
    const response = await authed({ method: 'POST', url: `/api/rerate/${film.id}`, payload: { scores } });
    assert.equal(response.statusCode, 400, `${JSON.stringify(scores)}: ${response.body}`);
    assert.ok(response.json().message);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM rerates').get()!.n, 0);
  db.exec("CREATE TRIGGER block_score BEFORE INSERT ON rerate_scores WHEN NEW.viewer_id=2 BEGIN SELECT RAISE(ABORT,'blocked'); END");
  const failed = await authed({ method: 'POST', url: `/api/rerate/${film.id}`, payload: { scores: { 1: 0, 2: 10 } } });
  assert.equal(failed.statusCode, 400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rerates').get()!.n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rerate_scores').get()!.n, 0);
  db.exec('DROP TRIGGER block_score');
  assert.equal((await authed({ method: 'POST', url: `/api/rerate/${film.id}`, payload: { scores: { 1: 0, 2: 10 } } })).statusCode, 200);
});

test('renote : révélation publique, originaux et statistiques inchangés, conflit puis suppression et cascade', async t => {
  const { db, app, repo, authed } = testApp(t, { now });
  const film = repo.create({ title: 'Mémoire', watched_at: '2020-01-01T00:00:00Z',
    ratings: [{ viewer_id: 1, score: 7 }, { viewer_id: 2, score: 7 }] });
  const stats = (await app.inject('/api/stats')).json();
  const original = repo.get(film.id), url = `/api/rerate/${film.id}`;
  const payload = { scores: { 1: 8, 2: 5 } };
  const response = await authed({ method: 'POST', url, payload });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { film_id: film.id, created_at: '2026-11-20T12:00:00.000Z', scores: [
    { viewer_id: 1, name: 'Fleur', score: 8, original: 7, delta: 1 },
    { viewer_id: 2, name: 'Noé', score: 5, original: 7, delta: -2 },
  ] });
  const sheet = (await app.inject(`/api/films/${film.id}`)).json();
  const { film_id, ...rerate } = response.json();
  assert.deepEqual(sheet.rerate, rerate);
  assert.deepEqual({ ...sheet, rerate: null }, original);
  assert.deepEqual((await app.inject('/api/stats')).json(), stats);
  assert.deepEqual((await authed({ url: '/api/rerate/next' })).json(), { remaining: 0, film: null });
  assert.equal((await authed({ method: 'POST', url, payload })).statusCode, 409);
  assert.equal((await authed({ method: 'POST', url: `${url}/ignore` })).statusCode, 409);
  assert.equal((await authed({ method: 'DELETE', url })).statusCode, 204);
  assert.equal(repo.get(film.id).rerate, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rerate_scores').get()!.n, 0);
  assert.equal((await authed({ url: '/api/rerate/next' })).json().film.id, film.id);
  assert.equal((await authed({ method: 'DELETE', url })).statusCode, 404);
  await authed({ method: 'POST', url, payload });
  await authed({ method: 'DELETE', url: `/api/films/${film.id}` });
  for (const table of ['rerates', 'rerate_scores']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
});

test('renote : originaux manquants, égalité, ignorer et annuler, films récents ou inconnus', async t => {
  const { app, repo, authed } = testApp(t, { now });
  const film = repo.create({ title: 'Sans note', watched_at: '2020-01-01T00:00:00Z', ratings: [{ viewer_id: 2, score: 5 }] });
  const recent = repo.create({ title: 'Récent', watched_at: '2026-01-01T00:00:00Z' });
  const payload = { scores: { 1: 8, 2: 5 } }, url = `/api/rerate/${film.id}`;
  const rated = await authed({ method: 'POST', url, payload });
  assert.equal(rated.json().scores[0].original, null); assert.equal(rated.json().scores[0].delta, null);
  assert.equal(rated.json().scores[1].delta, 0);
  await authed({ method: 'DELETE', url });
  assert.equal((await authed({ method: 'POST', url: `${url}/ignore` })).statusCode, 204);
  assert.deepEqual((await authed({ url: '/api/rerate/next' })).json(), { remaining: 0, film: null });
  assert.equal((await app.inject(`/api/films/${film.id}`)).json().rerate, null);
  assert.equal((await authed({ method: 'POST', url, payload })).statusCode, 409);
  assert.equal((await authed({ method: 'POST', url: `${url}/ignore` })).statusCode, 409);
  assert.equal((await authed({ method: 'DELETE', url })).statusCode, 204);
  assert.equal((await authed({ url: '/api/rerate/next' })).json().remaining, 1);
  for (const id of [recent.id, 999]) {
    for (const suffix of ['', '/ignore']) {
      const response = await authed({ method: 'POST', url: `/api/rerate/${id}${suffix}`, ...(suffix ? {} : { payload }) });
      assert.equal(response.statusCode, id === 999 ? 404 : 409, response.body);
    }
  }
  assert.equal((await authed({ method: 'DELETE', url: '/api/rerate/999' })).statusCode, 404);
});

test('renote : retrait de deux années calendaires UTC et 29 février', () => {
  assert.equal(rerateCutoff(now()), '2024-11-20T12:00:00.000Z');
  assert.equal(rerateCutoff(Date.parse('2028-02-29T23:30:00Z')), '2026-02-28T23:30:00.000Z');
});
