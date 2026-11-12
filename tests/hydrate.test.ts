import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDb, tempDir, json } from './helpers.ts';
import { FilmsRepo } from '../server/repo/films.ts';
import { openDatabase } from '../server/db/index.ts';
import { OmdbClient, BudgetExceeded } from '../server/services/omdb.ts';
import { WikidataClient, WikidataUnavailable } from '../server/services/wikidata.ts';
import { Hydrator, HydrationConflict, guessYear } from '../server/services/hydrate.ts';
import { main, parseOptions } from '../scripts/hydrate.ts';
import { synopsisExtract, synopsisText } from './fixtures/wikipedia.ts';

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

test('titres originaux : Wikidata corrige OMDb, préserve une saisie distincte et OMDb ne sert que sans match', async t => {
  for (const scenario of [
    { original: 'An Ordinary Case', wiki: [{ originalTitle: { value: 'Le Fil' } }], expected: 'Le Fil', selected: null },
    { original: 'Titre choisi à la main', wiki: [{ originalTitle: { value: 'Le Fil' } }], expected: 'Titre choisi à la main', selected: null },
    { original: null, wiki: [{ filmLabel: { value: 'Le Fil' } }], expected: null, selected: null },
    { original: null, wiki: [], expected: 'An Ordinary Case', selected: null },
    { original: null, wiki: [], expected: null, selected: { originalTitle: null } },
    { original: null, wiki: [], expected: 'Le Fil', selected: { originalTitle: 'Le Fil' } },
  ]) {
    const db = tempDb(t), repo = new FilmsRepo(db);
    const film = repo.create({ title: 'Le Fil', original_title: scenario.original,
      imdb_id: scenario.selected ? null : 'tt1234567',
      hydrated_at: scenario.selected ? null : '2026-01-01T00:00:00Z',
      omdb_raw: JSON.stringify({ Title: 'An Ordinary Case' }) });
    const fetch: typeof globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.hostname === 'www.omdbapi.com') return json({ ...details, Title: 'An Ordinary Case', Poster: 'N/A' });
      assert.equal(url.hostname, 'query.wikidata.org'); return json({ results: { bindings: scenario.wiki } });
    };
    const client = new WikidataClient(db, { fetch, throttle: async () => {} });
    if (scenario.selected) t.mock.method(client, 'searchFilms', async () => [{ imdbID: 'tt1234567', qid: 'Q123', titleFr: 'Le Fil',
      titleEn: 'An Ordinary Case', originalTitle: scenario.selected!.originalTitle, originalLanguage: 'fr', year: 1999, directors: [] }]);
    const hydrator = new Hydrator(repo, new OmdbClient(db, { fetch, apiKey: 'test' }), client, { fetch });
    assert.equal((await hydrator.hydrateFilm(film.id, { force: true })).original_title, scenario.expected);
  }
});

test('synopsis français : conservé séparément et panne Wikipédia sans arrêt du film ni du lot', async t => {
  for (const failure of [false, true]) {
    const db = tempDb(t), repo = new FilmsRepo(db), logs: unknown[][] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args); });
    const fetch: typeof globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.hostname === 'www.omdbapi.com') return json({ ...details, imdbID: url.searchParams.get('i'), Poster: 'N/A' });
      if (url.hostname === 'query.wikidata.org') return json({ results: { bindings: [{ frWiki: { value: 'Film français' }, originalTitle: { value: 'Le Fil' } }] } });
      assert.equal(url.hostname, 'fr.wikipedia.org');
      return failure ? new Response('', { status: 500 }) : json({ query: { pages: [{ extract: synopsisExtract }] } });
    };
    const omdb = new OmdbClient(db, { fetch, apiKey: 'test' });
    const hydrator = new Hydrator(repo, omdb, new WikidataClient(db, { fetch, throttle: async () => {} }), { fetch });
    for (const imdb_id of ['tt1234567', 'tt7654321']) {
      const film = repo.create({ title: imdb_id, imdb_id, summary: 'Texte personnel' });
      const result = await hydrator.hydrateFilm(film.id);
      assert.equal(result.hydrated, true); assert.equal(result.plot_fr, failure ? null : synopsisText);
      assert.equal(result.summary, 'Texte personnel'); assert.equal(result.plot_en, 'English plot');
    }
    assert.equal(omdb.budget().used, 2); assert.equal(logs.length, failure ? 2 : 0);
  }
});

test('CLI --refresh : sélectionne les films enrichis, corrige le titre et récupère plot_fr sans budget OMDb', async t => {
  const path = join(tempDir(t), 'refresh.db'), db = openDatabase(path), repo = new FilmsRepo(db);
  const film = repo.create({ title: 'An Ordinary Case', imdb_id: 'tt1234567' });
  repo.create({ title: 'À choisir', needs_review: true });
  let calls = 0;
  const fetch: typeof globalThis.fetch = async input => {
    calls++;
    const url = new URL(String(input));
    if (url.hostname === 'www.omdbapi.com') return json({ ...details, Title: 'An Ordinary Case', Poster: 'N/A' });
    if (url.hostname === 'query.wikidata.org') return json({ results: { bindings: [{ originalTitle: { value: 'Le Fil' }, frWiki: { value: 'Le Fil' } }] } });
    assert.equal(url.hostname, 'fr.wikipedia.org'); return json({ query: { pages: [{ extract: synopsisExtract }] } });
  };
  const omdb = new OmdbClient(db, { fetch, apiKey: 'test' });
  const hydrator = new Hydrator(repo, omdb, new WikidataClient(db, { fetch, throttle: async () => {} }), { fetch });
  await hydrator.hydrateFilm(film.id);
  const budget = omdb.budget().used;
  assert.equal(budget, 1);
  repo.patch(film.id, { original_title: 'An Ordinary Case', plot_fr: null, hydrated_at: '2026-01-01T00:00:00Z' });
  // Default hydration still skips; force refresh runs every enrichment stage from cache.
  assert.equal((await hydrator.hydrateFilm(film.id)).plot_fr, null);
  assert.equal((await hydrator.hydrateFilm(film.id, { force: true })).plot_fr, synopsisText);
  assert.equal(omdb.budget().used, budget); assert.equal(calls, 3);
  repo.patch(film.id, { original_title: 'An Ordinary Case', plot_fr: null });
  db.close();
  const output: unknown[][] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => { output.push(args); });
  const previousPath = process.env.DB_PATH;
  process.env.DB_PATH = path;
  try {
    await main(['--refresh', '--limit', '10']);
    const saved = openDatabase(path);
    try {
      const result = new FilmsRepo(saved).get(film.id);
      assert.equal(result.original_title, 'Le Fil'); assert.equal(result.plot_fr, synopsisText);
      assert.equal(new OmdbClient(saved).budget().used, budget);
      assert.ok(output.some(args => String(args[0]).includes('Films restant à vérifier : 1')));
    } finally { saved.close(); }
  } finally { if (previousPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previousPath; }
});

test('hydratation complète simulée : repli t/y après Wikidata vide, champs, crew, affiche et cache', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db), postersDir = tempDir(t), urls: URL[] = [];
  const film = repo.create({ title: 'Film (1999)', summary: 'Résumé personnel', comment: 'Souvenir',
    credits: [{ role: 'writer', name: 'Scénariste', position: 0, source: 'manual' }] });
  const fetch: typeof globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.hostname === 'www.wikidata.org') return json({ search: [] });
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
  assert.equal(result.id, same.id); assert.equal(urls.length, 5);
  assert.equal(urls[2]!.searchParams.get('t'), 'Film'); assert.equal(urls[2]!.searchParams.get('y'), '1999');
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
  await hydrator.hydrateFilm(film.id); assert.equal(urls.length, 5);
  // Simulate an interrupted finalization; cached details/wiki/poster avoid all calls.
  repo.patch(film.id, { hydrated_at: null });
  await hydrator.hydrateFilm(film.id); assert.equal(urls.length, 5);
});

test('titre introuvable ou année incohérente : needs_review après Wikidata vide, sans affiche', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db); let calls = 0;
  const fetch: typeof globalThis.fetch = async input => {
    if (new URL(String(input)).hostname === 'www.wikidata.org') return json({ search: [] });
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
  const hydrator = new Hydrator(repo, new OmdbClient(db, { apiKey: 'test', fetch }), new WikidataClient(db, { fetch, sleep: async () => {} }), { fetch, postersDir: tempDir(t) });
  await assert.rejects(hydrator.hydrateFilm(film.id), /Wikidata HTTP/);
  assert.equal(repo.get(film.id).runtime_min, 123); assert.equal(repo.get(film.id).hydrated, false);
  fail = false;
  const result = await hydrator.hydrateFilm(film.id);
  assert.equal(result.hydrated, true); assert.equal(result.poster_url, null); assert.equal(omdbCalls, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM api_log WHERE provider='wikidata'").get()!.n, 5);
});

test('quota épuisé propagé sans marquer le film hydraté', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db), film = repo.create({ title: 'Film', imdb_id: 'tt1234567' });
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
  assert.deepEqual(parseOptions([]), { limit: 20, dryRun: false, refresh: false, id: undefined });
  assert.deepEqual(parseOptions(['--limit', '3', '--dry-run', '--id', '42', '--refresh']), { limit: 3, dryRun: true, refresh: true, id: 42 });
  for (const args of [['--limit', '0'], ['--limit', '1.2'], ['--id', '-1'], ['--inconnu']]) assert.throws(() => parseOptions(args));
  assert.equal(guessYear({ title: 'Film (1999)', year: null }), 1999);
  assert.equal(guessYear({ title: '1917', year: null }), undefined);
});

test('CLI : panne Wikidata arrête le lot proprement sans OMDb ni needs_review', async t => {
  const path = join(tempDir(t), 'batch.db'), db = openDatabase(path), repo = new FilmsRepo(db);
  repo.create({ title: 'Premier film' }); repo.create({ title: 'Deuxième film' });
  db.close();
  const output: unknown[][] = []; let searches = 0;
  t.mock.method(console, 'log', (...args: unknown[]) => { output.push(args); });
  t.mock.method(WikidataClient.prototype, 'searchFilms', async () => {
    searches++;
    throw new WikidataUnavailable('Wikidata HTTP 429');
  });
  const previousPath = process.env.DB_PATH, previousExitCode = process.exitCode;
  process.env.DB_PATH = path;
  try {
    await main(['--limit', '2']);
    assert.equal(searches, 1);
    assert.ok(output.some(args => String(args[0]).includes('Wikidata indisponible, arrêt propre')));
    assert.equal(process.exitCode, previousExitCode);
    const saved = openDatabase(path);
    try {
      assert.ok(new FilmsRepo(saved).list().every(f => !f.hydrated && !f.needs_review && !f.imdb_id));
      assert.equal(saved.prepare("SELECT count(*) AS n FROM api_log WHERE provider='omdb'").get()!.n, 0);
    } finally { saved.close(); }
  } finally {
    if (previousPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previousPath;
    process.exitCode = previousExitCode;
  }
});
