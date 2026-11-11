import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilmsRepo } from '../server/repo/films.ts';
import { Hydrator, selectWikidataCandidate } from '../server/services/hydrate.ts';
import { OmdbClient } from '../server/services/omdb.ts';
import { WikidataClient, WikidataUnavailable } from '../server/services/wikidata.ts';
import { json, tempDb, tempDir } from './helpers.ts';
import { dansMaPeau, knivesOut, knivesHomonyms, parasite, parasiteHomonyms, wikidataFixture } from './fixtures/wikidata.ts';

const film = (title: string, director_text: string | null = null, year: number | null = null, watched_at = '2026-11-12T12:00:00Z') => ({ title, director_text, year, watched_at });
test('résolution : titres FR/EN/original, accents, ponctuation, noms/annotations et homonymes', () => {
  for (const title of ['Dans ma peau', 'DANS MA PEAU', 'In My Skin']) {
    assert.equal(selectWikidataCandidate(film(title, 'Marina de Van'), [dansMaPeau]).best?.imdbID, dansMaPeau.imdbID);
  }
  assert.equal(selectWikidataCandidate(film('Dans ma peau', 'de Van (annotation)'), [dansMaPeau]).best?.imdbID, dansMaPeau.imdbID);
  for (const title of ['A Couteaux Tirés', 'à couteaux-tirés', 'Knives Out']) {
    assert.equal(selectWikidataCandidate(film(title, 'Johnson'), knivesHomonyms).best?.imdbID, knivesOut.imdbID);
  }
  for (const title of ['Parasite', '기생충']) {
    assert.equal(selectWikidataCandidate(film(title, 'Bong Joon Ho'), parasiteHomonyms).best?.imdbID, parasite.imdbID);
  }
  assert.equal(selectWikidataCandidate(film('Parasite', 'Autre / Prendergast'), parasiteHomonyms).best?.year, 2004);
});

test('résolution prudente : ambiguïté, année indicatrice, sortie après visionnage, date Paris et réalisateur divergent', () => {
  assert.equal(selectWikidataCandidate(film('Parasite'), parasiteHomonyms).best, null);
  assert.equal(selectWikidataCandidate(film('A couteaux tirés'), knivesHomonyms).best, null);
  assert.equal(selectWikidataCandidate(film('Parasite (2019)'), parasiteHomonyms).best?.imdbID, parasite.imdbID);
  assert.equal(selectWikidataCandidate(film('Parasite', null, 1982), parasiteHomonyms).best?.year, 1982);
  assert.equal(selectWikidataCandidate(film('Parasite (2020)', 'Bong Joon-ho'), parasiteHomonyms).best, null);
  assert.equal(selectWikidataCandidate(film('Parasite', 'Bong Joon-ho', null, '2018-12-01T00:00:00Z'), parasiteHomonyms).best, null);
  assert.equal(selectWikidataCandidate(film('Parasite', null, 2019, '2018-12-31T23:30:00Z'), parasiteHomonyms).best?.year, 2019);
  assert.equal(selectWikidataCandidate(film('Dans ma peau'), [dansMaPeau]).best?.imdbID, dansMaPeau.imdbID);
  assert.equal(selectWikidataCandidate(film('Dans ma peau', 'David Lynch'), [dansMaPeau]).best, null);
  assert.equal(selectWikidataCandidate(film('Un titre approchant', 'Marina de Van'), [dansMaPeau]).best, null);
  assert.equal(selectWikidataCandidate(film('Dans ma peau'), [{ ...dansMaPeau, year: null }]).best, null);
  assert.equal(selectWikidataCandidate(film('Dans ma peau', 'Marina de Van'), [dansMaPeau, { ...dansMaPeau, imdbID: 'tt9999999' }]).best, null);
});

test('hydratation Wikidata : un seul appel OMDb i=, titres préservés, crédits et reprise du cache', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db), fixture = wikidataFixture(parasiteHomonyms), omdbUrls: URL[] = [];
  const entry = repo.create({ title: 'Parasite', director_text: 'Bong Joon-ho', watched_at: '2020-01-01T12:00:00Z' });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'www.wikidata.org') return fixture.fetch(input, init);
    if (url.hostname === 'query.wikidata.org') return json({ results: { bindings: [{
      filmLabel: { value: 'Parasite' }, originalTitle: { value: '기생충' }, role: { value: 'composer' }, name: { value: 'Jung Jae-il' },
    }] } });
    assert.equal(url.hostname, 'www.omdbapi.com'); omdbUrls.push(url);
    assert.equal(url.searchParams.get('i'), parasite.imdbID); assert.equal(url.searchParams.has('t'), false);
    return json({ Response: 'True', imdbID: parasite.imdbID, Title: 'Parasite', Year: '2019', Poster: 'N/A', Director: 'Bong Joon Ho' });
  };
  const omdb = new OmdbClient(db, { fetch, apiKey: 'mock' });
  const hydrator = new Hydrator(repo, omdb, new WikidataClient(db, { fetch, throttle: async () => {} }), { fetch, postersDir: tempDir(t) });
  const result = await hydrator.hydrateFilm(entry.id);
  assert.equal(result.title, 'Parasite'); assert.equal(result.imdb_id, parasite.imdbID);
  assert.equal(result.title_fr, 'Parasite'); assert.equal(result.original_title, '기생충');
  assert.equal(result.hydrated, true); assert.equal(result.needs_review, false);
  assert.ok(result.credits.some(c => c.name === 'Jung Jae-il')); assert.equal(omdb.budget().used, 1);
  repo.patch(entry.id, { hydrated_at: null });
  assert.equal((await hydrator.hydrateFilm(entry.id)).original_title, '기생충');
  assert.equal(omdbUrls.length, 1); assert.equal(fixture.calls.length, 4);
});

test('identifiant choisi : aucune recherche de titre, P1476 récupéré même si OMDb donne un titre anglais', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db), urls: URL[] = [];
  const entry = repo.create({ title: 'DANS MA PEAU', imdb_id: dansMaPeau.imdbID });
  const fetch: typeof globalThis.fetch = async input => {
    const url = new URL(String(input)); urls.push(url);
    if (url.hostname === 'www.omdbapi.com') {
      assert.equal(url.searchParams.get('i'), dansMaPeau.imdbID);
      return json({ Response: 'True', imdbID: dansMaPeau.imdbID, Title: 'In My Skin', Year: '2002', Poster: 'N/A' });
    }
    assert.equal(url.hostname, 'query.wikidata.org');
    assert.match(url.searchParams.get('query')!, /SELECT \?filmLabel \?originalTitle/);
    assert.match(url.searchParams.get('query')!, /P1476/);
    return json({ results: { bindings: [{ filmLabel: { value: 'Dans ma peau' }, originalTitle: { value: 'Dans ma peau' } }] } });
  };
  const hydrator = new Hydrator(repo, new OmdbClient(db, { apiKey: 'mock', fetch }), new WikidataClient(db, { fetch }), { fetch });
  const result = await hydrator.hydrateFilm(entry.id);
  assert.equal(result.title, 'DANS MA PEAU'); assert.equal(result.title_fr, 'Dans ma peau'); assert.equal(result.original_title, 'Dans ma peau');
  assert.equal(urls.length, 2);
});

test('ambiguïté/futur : revue avec candidats persistés, aucune consommation OMDb, choix manuel par ID', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db), fixture = wikidataFixture(knivesHomonyms); let omdbCalls = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'www.wikidata.org') return fixture.fetch(input, init);
    if (url.hostname === 'query.wikidata.org') return json({ results: { bindings: [] } });
    omdbCalls++; assert.equal(url.searchParams.get('i'), knivesOut.imdbID);
    return json({ Response: 'True', imdbID: knivesOut.imdbID, Title: 'Knives Out', Year: '2019', Poster: 'N/A' });
  };
  const omdb = new OmdbClient(db, { apiKey: 'mock', fetch });
  const hydrator = new Hydrator(repo, omdb, new WikidataClient(db, { fetch, throttle: async () => {} }), { fetch });
  const entry = repo.create({ title: 'A Couteaux Tirés' });
  const review = await hydrator.hydrateFilm(entry.id);
  assert.equal(review.needs_review, true); assert.equal(review.imdb_id, null); assert.equal(omdbCalls, 0);
  assert.deepEqual(JSON.parse(review.wikidata_raw!).searchCandidates.map((c: { imdbID: string }) => c.imdbID), knivesHomonyms.map(c => c.imdbID));
  const future = repo.create({ title: 'A Couteaux Tirés (2019)', director_text: 'Rian Johnson', watched_at: '2018-01-01T00:00:00Z' });
  assert.equal((await hydrator.hydrateFilm(future.id)).needs_review, true); assert.equal(omdbCalls, 0);
  repo.patch(entry.id, { imdb_id: knivesOut.imdbID });
  assert.equal((await hydrator.hydrateFilm(entry.id)).hydrated, true); assert.equal(omdbCalls, 1);
});

test('panne Wikidata à la résolution : erreur réessayable sans devinette OMDb', async t => {
  const db = tempDb(t), repo = new FilmsRepo(db), entry = repo.create({ title: 'Dans ma peau' });
  let calls = 0; const delays: number[] = [];
  const fetch: typeof globalThis.fetch = async input => {
    assert.equal(new URL(String(input)).hostname, 'www.wikidata.org');
    calls++;
    return new Response('', { status: 429 });
  };
  const omdb = new OmdbClient(db, { apiKey: 'mock', fetch });
  const hydrator = new Hydrator(repo, omdb, new WikidataClient(db, { fetch, throttle: async () => {}, sleep: async ms => { delays.push(ms); } }), { fetch });
  await assert.rejects(hydrator.hydrateFilm(entry.id), error => error instanceof WikidataUnavailable && error.retryable);
  assert.equal(calls, 8);
  assert.deepEqual(delays.slice().sort((a, b) => a - b), [2000, 2000, 4000, 4000, 8000, 8000]);
  assert.equal(omdb.budget().used, 0);
  assert.equal(repo.get(entry.id).needs_review, false);
  assert.equal(repo.get(entry.id).hydrated, false);
  assert.equal(repo.get(entry.id).imdb_id, null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM api_log WHERE provider='omdb'").get()!.n, 0);
});
