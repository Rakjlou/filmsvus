import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDb, tempDir, json } from './helpers.ts';
import { FilmsRepo } from '../server/repo/films.ts';
import { OmdbClient, BudgetExceeded } from '../server/services/omdb.ts';
import { WikidataClient } from '../server/services/wikidata.ts';
import { Hydrator, HydrationConflict, guessYear } from '../server/services/hydrate.ts';
import { parseOptions } from '../scripts/hydrate.ts';

const details = {
  Response: 'True', imdbID: 'tt1234567', Title: 'Film', Year: '1999', Runtime: '123 min',
  Genre: 'Drama, Thriller', Country: 'France, USA', Language: 'French, English', Rated: 'R',
  imdbRating: '8.3', imdbVotes: '123,456', Metascore: '78',
  Ratings: [{ Source: 'Rotten Tomatoes', Value: '91%' }], Awards: 'Un prix', BoxOffice: '$42',
  Director: 'Réalisateur', Writer: 'Scénariste', Actors: 'Acteur 1, Acteur 2', Plot: 'English plot',
  Poster: 'https://images.example.org/poster.jpg',
};
const wiki = { results: { bindings: [
  { filmLabel: { value: 'Titre français' }, role: { value: 'composer' }, name: { value: 'Compositeur' } },
  { role: { value: 'composer' }, name: { value: 'Compositeur' } },
  { role: { value: 'writer' }, name: { value: 'Scénariste' } },
  { role: { value: 'cinematographer' }, name: { value: 'Chef op' } },
  { role: { value: 'editor' }, name: { value: 'Monteur' } },
  { role: { value: 'producer' }, name: { value: 'Producteur' } },
  { role: { value: 'company' }, name: { value: 'Studio' } },
] } };

test('hydratation complète simulée : résolution t/y, champs, crew dédoublonné, société, affiche et cache', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db), postersDir = tempDir(t), urls: URL[] = [];
  const film = repo.create({ title: 'Film (1999)', summary: 'Résumé personnel', comment: 'Souvenir',
    credits: [{ role: 'writer', name: 'Scénariste', position: 0, source: 'manual' }] });
  const fetch: typeof globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.hostname === 'www.omdbapi.com') return json(details);
    if (url.hostname === 'query.wikidata.org') {
      assert.equal((options!.headers as Record<string, string>)['User-Agent'], 'filmsvus-local/0.1');
      for (const property of ['P345', 'P86', 'P344', 'P1040', 'P162', 'P58', 'P272']) assert.ok(url.searchParams.get('query')!.includes(property));
      return json(wiki);
    }
    return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } });
  };
  const omdb = new OmdbClient(db, { apiKey: 'test', fetch });
  const wikidata = new WikidataClient(db, { fetch });
  const hydrator = new Hydrator(repo, omdb, wikidata, { fetch, postersDir, now: () => new Date('2026-11-11T12:00:00Z') });
  const [result, same] = await Promise.all([hydrator.hydrateFilm(film.id), hydrator.hydrateFilm(film.id)]);
  assert.equal(result.id, same.id); assert.equal(urls.length, 3);
  assert.equal(urls[0]!.searchParams.get('t'), 'Film'); assert.equal(urls[0]!.searchParams.get('y'), '1999');
  assert.equal(result.imdb_id, 'tt1234567'); assert.equal(result.title_fr, 'Titre français');
  assert.equal(result.year, 1999); assert.equal(result.runtime_min, 123);
  assert.deepEqual(result.genres, ['Drama', 'Thriller']); assert.deepEqual(result.languages, ['French', 'English']);
  assert.equal(result.imdb_rating, 8.3); assert.equal(result.imdb_votes, 123456);
  assert.equal(result.metascore, 78); assert.equal(result.rt_score, 91);
  assert.equal(result.summary, 'Résumé personnel'); assert.equal(result.comment, 'Souvenir');
  assert.equal(result.credits.filter(c => c.role === 'writer').length, 1);
  assert.equal(result.credits.find(c => c.role === 'writer')!.source, 'manual');
  assert.equal(result.credits.filter(c => c.role === 'actor').length, 2);
  assert.equal(result.credits.find(c => c.role === 'composer')!.source, 'wikidata');
  assert.deepEqual(result.companies, [{ name: 'Studio', source: 'wikidata' }]);
  assert.equal(result.poster_url, '/posters/tt1234567.jpg');
  assert.deepEqual([...await readFile(join(postersDir, 'tt1234567.jpg'))], [255, 216, 255, 217]);
  assert.equal(result.hydrated_at, '2026-11-11T12:00:00.000Z'); assert.equal(omdb.budget().used, 1);
  await hydrator.hydrateFilm(film.id); assert.equal(urls.length, 3);
  // Simulate an interrupted finalization; cached details/wiki/poster avoid all calls.
  repo.patch(film.id, { hydrated_at: null });
  await hydrator.hydrateFilm(film.id); assert.equal(urls.length, 3);
});

test('titre introuvable ou année incohérente : needs_review sans Wikidata/affiche', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db); let calls = 0;
  const fetch: typeof globalThis.fetch = async input => {
    calls++;
    assert.equal(new URL(String(input)).hostname, 'www.omdbapi.com');
    return calls === 1 ? json({ Response: 'False', Error: 'Movie not found!' }) : json({ ...details, Year: '2000' });
  };
  const hydrate = new Hydrator(repo, new OmdbClient(db, { apiKey: 'test', fetch }), new WikidataClient(db, { fetch }), { fetch });
  for (const title of ['Inconnu', 'Film (1999)']) {
    const result = await hydrate.hydrateFilm(repo.create({ title }).id);
    assert.equal(result.needs_review, true); assert.equal(result.hydrated, false); assert.equal(result.imdb_id, null);
  }
  assert.equal(calls, 2);
});

test('échec Wikidata : OMDb conservé, reprise par cache, N/A sans téléchargement', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db); let fail = true, omdbCalls = 0;
  const film = repo.create({ title: 'Film', imdb_id: 'tt1234567' });
  const fetch: typeof globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === 'www.omdbapi.com') { omdbCalls++; return json({ ...details, Poster: 'N/A' }); }
    if (fail) return new Response('Indisponible', { status: 503 });
    return json({ results: { bindings: [] } });
  };
  const hydrator = new Hydrator(repo, new OmdbClient(db, { apiKey: 'test', fetch }), new WikidataClient(db, { fetch }), { fetch, postersDir: tempDir(t) });
  await assert.rejects(hydrator.hydrateFilm(film.id), /Wikidata HTTP/);
  assert.equal(repo.get(film.id).runtime_min, 123); assert.equal(repo.get(film.id).hydrated, false);
  fail = false;
  const result = await hydrator.hydrateFilm(film.id);
  assert.equal(result.hydrated, true); assert.equal(result.poster_url, null); assert.equal(omdbCalls, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM api_log WHERE provider='wikidata'").get()!.n, 2);
});

test('quota épuisé propagé sans marquer le film hydraté', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db), film = repo.create({ title: 'Film' });
  const hydrator = new Hydrator(repo, new OmdbClient(db, { apiKey: 'test', dailyBudget: 0 }), new WikidataClient(db));
  await assert.rejects(hydrator.hydrateFilm(film.id), BudgetExceeded);
  assert.equal(repo.get(film.id).hydrated, false);
});

test('édition pendant un appel réseau : aucune métadonnée écrite sur le nouvel IMDb', async t => {
  for (const phase of ['omdb', 'wikidata']) {
    const db = tempDb(t), repo = new FilmsRepo(db);
    const film = repo.create({ title: 'Film', imdb_id: 'tt1234567' });
    const fetch: typeof globalThis.fetch = async input => {
      const isOmdb = new URL(String(input)).hostname === 'www.omdbapi.com';
      if ((isOmdb && phase === 'omdb') || (!isOmdb && phase === 'wikidata')) repo.patch(film.id, { imdb_id: 'tt7654321' });
      return isOmdb ? json({ ...details, Poster: 'N/A' }) : json(wiki);
    };
    const hydrate = new Hydrator(repo, new OmdbClient(db, { apiKey: 'test', fetch }), new WikidataClient(db, { fetch }), { fetch });
    await assert.rejects(hydrate.hydrateFilm(film.id), HydrationConflict);
    const current = repo.get(film.id);
    assert.equal(current.imdb_id, 'tt7654321'); assert.equal(current.hydrated, false);
    assert.equal(current.runtime_min, null); assert.deepEqual(current.credits, []);
  }
});

test('CLI : défauts, limite, id, simulation et validation', () => {
  assert.deepEqual(parseOptions([]), { limit: 20, dryRun: false, id: undefined });
  assert.deepEqual(parseOptions(['--limit', '3', '--dry-run', '--id', '42']), { limit: 3, dryRun: true, id: 42 });
  for (const args of [['--limit', '0'], ['--limit', '1.2'], ['--id', '-1'], ['--inconnu']]) assert.throws(() => parseOptions(args));
  assert.equal(guessYear({ title: 'Film (1999)', year: null }), 1999);
  assert.equal(guessYear({ title: '1917', year: null }), undefined);
});
