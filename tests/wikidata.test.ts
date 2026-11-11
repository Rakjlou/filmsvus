import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WikidataClient, WikidataUnavailable } from '../server/services/wikidata.ts';
import { OmdbClient } from '../server/services/omdb.ts';
import { UpstreamError } from '../server/services/network.ts';
import { buildApp } from '../server/index.ts';
import { json, tempDb, tempDir, offline } from './helpers.ts';
import { dansMaPeau, knivesOut, parasite, wikidataFixture } from './fixtures/wikidata.ts';

const noThrottle = async () => {};
test('Wikidata : fusion FR/EN dans l’ordre, filtrage IMDb/séries, année minimale et noms des réalisateurs', async t => {
  const db = tempDb(t);
  const fixture = wikidataFixture([dansMaPeau, knivesOut, parasite], { noise: true,
    fr: [dansMaPeau.qid, 'Q900', 'Q901', 'Q902', 'Q903', knivesOut.qid],
    en: [knivesOut.qid, parasite.qid, dansMaPeau.qid] });
  const client = new WikidataClient(db, { fetch: fixture.fetch, throttle: noThrottle });
  const [results, same] = await Promise.all([client.searchFilms('Dans ma peau'), client.searchFilms('Dans ma peau')]);
  assert.deepEqual(results, [dansMaPeau, knivesOut, parasite]); assert.deepEqual(same, results);
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(fixture.calls.slice(0, 2).map(url => url.searchParams.get('language')), ['fr', 'en']);
  assert.equal(fixture.calls[2]!.searchParams.get('ids'), `${dansMaPeau.qid}|Q900|Q901|Q902|Q903|${knivesOut.qid}|${parasite.qid}`);
  assert.equal(fixture.calls[3]!.searchParams.get('props'), 'labels');
  assert.equal(fixture.calls[3]!.searchParams.get('languages'), 'fr|en');
  // A new client/process can reuse every response; Wikidata consumes no OMDb budget.
  assert.deepEqual(await new WikidataClient(db, { fetch: offline }).searchFilms(' Dans ma peau '), results);
  assert.equal(new OmdbClient(db).budget().used, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM api_log WHERE provider='wikidata' AND status=200 AND raw_response IS NOT NULL").get()!.n, 4);
});

test('Wikidata : recherche vide en cache, données absentes, erreurs et réponses invalides réessayables', async t => {
  const db = tempDb(t); let calls = 0;
  const client = new WikidataClient(db, { throttle: noThrottle, fetch: async () => { calls++; return json({ search: [] }); } });
  assert.deepEqual(await client.searchFilms(''), []); assert.equal(calls, 0);
  assert.deepEqual(await client.searchFilms('Inconnu'), []);
  assert.deepEqual(await client.searchFilms('Inconnu'), []); assert.equal(calls, 2);
  const bare = { ...parasite, titleFr: null, titleEn: null, originalTitle: null, originalLanguage: null, year: null, directors: [] };
  const fixture = wikidataFixture([bare]);
  assert.deepEqual(await new WikidataClient(db, { throttle: noThrottle, fetch: fixture.fetch }).searchFilms('Bare'), [bare]);
  assert.equal(fixture.calls.length, 3);
  for (const response of [() => new Response('', { status: 503 }), () => json({ error: { code: 'badvalue' } })]) {
    const broken = new WikidataClient(db, { throttle: noThrottle, sleep: noThrottle, fetch: async () => response() });
    await assert.rejects(broken.searchFilms('Échec'), UpstreamError);
  }
  const retry = new WikidataClient(db, { throttle: noThrottle, fetch: async () => json({ search: [] }) });
  assert.deepEqual(await retry.searchFilms('Échec'), []);
});

test('API recherche : Wikidata normalisé sans clé/quota OMDb, cache et liste multilingue', async t => {
  const db = tempDb(t), fixture = wikidataFixture([knivesOut]);
  const app = buildApp({ db, fetch: fixture.fetch, apiKey: '', dailyBudget: 0, throttleMs: 0,
    backgroundHydration: false, postersDir: tempDir(t) });
  t.after(() => app.close());
  const result = await app.inject('/api/search?q=A%20Couteaux%20Tir%C3%A9s');
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().Search, [{ imdbID: knivesOut.imdbID, title: 'À couteaux tirés', originalTitle: 'Knives Out',
    englishTitle: 'Knives Out', year: 2019, directors: ['Rian Johnson'], poster: null, source: 'wikidata' }]);
  assert.equal(result.json().budget.used, 0);
  await app.inject('/api/search?q=A%20Couteaux%20Tir%C3%A9s'); assert.equal(fixture.calls.length, 4);
  const film = (await app.inject({ method: 'POST', url: '/api/films', payload: { title: 'Mon titre', title_fr: 'Titre français', original_title: 'Original title' } })).json();
  const listed = (await app.inject('/api/films')).json().find((f: { id: number }) => f.id === film.id);
  assert.equal(listed.title_fr, 'Titre français'); assert.equal(listed.original_title, 'Original title');
});

test('API recherche : repli OMDb sur vide/erreur, source forcée, cache et quota', async t => {
  for (const fail of [false, true]) {
    const db = tempDb(t); let omdbCalls = 0, wikiCalls = 0;
    const app = buildApp({ db, apiKey: 'mock-key', dailyBudget: 1, throttleMs: 0, backgroundHydration: false, postersDir: tempDir(t),
      fetch: async input => {
        const url = new URL(String(input));
        if (url.hostname === 'www.wikidata.org') { wikiCalls++; return fail ? new Response('', { status: 429, headers: { 'Retry-After': '0' } }) : json({ search: [] }); }
        assert.equal(url.hostname, 'www.omdbapi.com'); assert.equal(url.searchParams.get('s'), 'Film');
        omdbCalls++;
        return json({ Response: 'True', Search: [{ Title: 'Film', Year: '2001', imdbID: 'tt1234567', Poster: 'N/A' }] });
      } });
    t.after(() => app.close());
    const response = await app.inject('/api/search?q=Film');
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().Search, [{ imdbID: 'tt1234567', title: 'Film', englishTitle: 'Film', originalTitle: null,
      year: 2001, directors: [], poster: null, source: 'omdb' }]);
    const expectedWikiCalls = fail ? 8 : 2;
    assert.equal(response.json().wikidataError, fail ? true : undefined);
    assert.equal(response.json().budget.used, 1); assert.equal(omdbCalls, 1); assert.equal(wikiCalls, expectedWikiCalls);
    const forced = await app.inject('/api/search?q=Film&source=omdb');
    assert.equal(forced.statusCode, 200); assert.equal(omdbCalls, 1); assert.equal(wikiCalls, expectedWikiCalls);
    assert.equal(forced.json().wikidataError, undefined);
    assert.equal((await app.inject('/api/search?q=Other&source=omdb')).statusCode, 429);
    assert.equal(wikiCalls, expectedWikiCalls); assert.equal(omdbCalls, 1);
    assert.equal((await app.inject('/api/search?q=Film&source=other')).statusCode, 400);
  }
});

test('Wikidata : 429 puis succès MediaWiki, Retry-After attendu avant le nouvel appel et résultat en cache', async t => {
  const db = tempDb(t), events: (string | number)[] = [];
  let frenchCalls = 0;
  const client = new WikidataClient(db, { throttle: noThrottle,
    sleep: async ms => { events.push(ms); },
    fetch: async input => {
      const language = new URL(String(input)).searchParams.get('language')!;
      events.push(language);
      if (language === 'fr' && ++frenchCalls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '7' } });
      return json({ search: [] });
    },
  });
  assert.deepEqual(await client.searchFilms('Film'), []);
  assert.deepEqual(events, ['fr', 'en', 7000, 'fr']);
  assert.deepEqual(await client.searchFilms('Film'), []);
  assert.equal(events.length, 4);
  assert.equal(db.prepare("SELECT count(*) AS n FROM api_log WHERE status=429 AND raw_response IS NULL").get()!.n, 1);
});

test('Wikidata : retries 429/503 bornés, plafond Retry-After et backoff par défaut, également en SPARQL', async t => {
  for (const status of [429, 503]) {
    for (const header of [undefined, '90', 'invalide', '-1']) {
      const db = tempDb(t), delays: number[] = []; let calls = 0;
      const client = new WikidataClient(db, { throttle: noThrottle,
        sleep: async ms => { delays.push(ms); },
        fetch: async () => { calls++; return new Response('', { status, headers: header === undefined ? {} : { 'Retry-After': header } }); },
      });
      await assert.rejects(client.byImdb('tt1234567'), error => error instanceof WikidataUnavailable && error.retryable);
      assert.equal(calls, 4);
      assert.deepEqual(delays, header === '90' ? [30_000, 30_000, 30_000] : [2000, 4000, 8000]);
      assert.equal(db.prepare("SELECT count(*) AS n FROM api_log WHERE raw_response IS NOT NULL").get()!.n, 0);
    }
  }
});

test('Wikidata : cache des entités réduit aux labels FR/EN et claims utiles, anciens caches réduits à la relecture', async t => {
  const db = tempDb(t), fixture = wikidataFixture([parasite]);
  const crewProperties = ['P58', 'P86', 'P344', 'P1040', 'P162', 'P272'];
  const client = new WikidataClient(db, { throttle: noThrottle, fetch: async (input, init) => {
    const response = await fixture.fetch(input, init);
    if (new URL(String(input)).searchParams.get('props') !== 'labels|claims') return response;
    const raw = await response.json();
    const entity = raw.entities[parasite.qid];
    entity.labels.de = { value: 'Parasite auf Deutsch' };
    entity.sitelinks = { enormous: 'x'.repeat(200_000) };
    entity.claims.P999 = [{ mainsnak: { datavalue: { value: 'discard' } } }];
    for (const property of crewProperties) entity.claims[property] = [{ mainsnak: { datavalue: { value: { id: 'Q123' } } }, references: ['x'.repeat(10_000)] }];
    return json(raw);
  } });
  assert.deepEqual(await client.searchFilms('Parasite'), [parasite]);
  const row = db.prepare("SELECT id,raw_response FROM api_log WHERE request_key LIKE '%props=labels%7Cclaims%'").get()!;
  const cached = JSON.parse(String(row.raw_response)), entity = cached.entities[parasite.qid];
  assert.ok(String(row.raw_response).length < 5000);
  assert.deepEqual(Object.keys(entity).sort(), ['claims', 'labels']);
  assert.deepEqual(Object.keys(entity.labels).sort(), ['en', 'fr']);
  assert.deepEqual(Object.keys(entity.claims).sort(), ['P31', 'P345', 'P577', 'P1476', 'P57', ...crewProperties].sort());
  for (const property of crewProperties) assert.deepEqual(entity.claims[property], [{ mainsnak: { datavalue: { value: { id: 'Q123' } } } }]);
  entity.sitelinks = { enormous: 'x'.repeat(200_000) };
  db.prepare('UPDATE api_log SET raw_response=? WHERE id=?').run(JSON.stringify(cached), row.id!);
  assert.deepEqual(await new WikidataClient(db, { fetch: offline }).searchFilms('Parasite'), [parasite]);
  assert.ok(String(db.prepare('SELECT raw_response FROM api_log WHERE id=?').get(row.id!)!.raw_response).length < 5000);
});
