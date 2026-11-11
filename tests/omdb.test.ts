import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDb, json } from './helpers.ts';
import { OmdbClient, BudgetExceeded, localDay, ConfigurationError } from '../server/services/omdb.ts';
import { UpstreamError } from '../server/services/network.ts';

test('OMDb : paramètres s/i/t/y, cache brut persistant, clé absente des logs', async t => {
  const db = tempDb(t), urls: URL[] = [];
  const fetch: typeof globalThis.fetch = async input => {
    urls.push(new URL(String(input))); return json({ Response: 'True', Title: 'Film' });
  };
  const client = new OmdbClient(db, { apiKey: 'secret-test', dailyBudget: 10, fetch });
  await client.search(' Film '); await client.search('Film');
  await client.byId('tt1234567'); await client.byTitle('Titre', 1999);
  assert.equal(urls.length, 3); assert.equal(client.budget().used, 3);
  assert.equal(urls[0]!.searchParams.get('s'), 'Film');
  assert.equal(urls[1]!.searchParams.get('i'), 'tt1234567');
  assert.equal(urls[2]!.searchParams.get('t'), 'Titre'); assert.equal(urls[2]!.searchParams.get('y'), '1999');
  assert.ok(urls.every(url => url.protocol === 'https:' && url.searchParams.get('apikey') === 'secret-test'));
  const other = new OmdbClient(db, { apiKey: '', dailyBudget: 0 });
  assert.equal((await other.search('Film')).Title, 'Film');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM api_log').all()).includes('secret-test'));
});

test('budget journalier Paris : minuit local, changement de jour et cache après épuisement', async t => {
  const db = tempDb(t); let now = new Date('2026-01-01T22:59:59Z'), calls = 0;
  const client = new OmdbClient(db, { apiKey: 'test', dailyBudget: 1, now: () => now,
    fetch: async () => { calls++; return json({ Response: 'True' }); } });
  await client.search('A');
  assert.equal(client.budget().remaining, 0);
  await assert.rejects(client.search('B'), BudgetExceeded);
  await client.search('A'); assert.equal(calls, 1);
  now = new Date('2026-01-01T23:00:00Z');
  assert.equal(client.budget().day, '2026-01-02'); assert.equal(client.budget().used, 0);
  await client.search('B'); assert.equal(calls, 2);
  assert.equal(localDay(new Date('2026-07-01T22:01:00Z')), '2026-07-02');
  assert.equal(localDay(new Date('2026-03-29T21:59:59Z')), '2026-03-29');
  assert.equal(localDay(new Date('2026-03-29T22:00:00Z')), '2026-03-30');
});

test('budget : chaque tentative échouée compte, erreurs et absence de clé', async t => {
  const db = tempDb(t); let calls = 0;
  const client = new OmdbClient(db, { apiKey: 'test', dailyBudget: 4, fetch: async () => {
    calls++;
    if (calls === 1) throw new Error('https://example.com/?apikey=secret');
    if (calls === 2) return new Response('Erreur', { status: 503 });
    if (calls === 3) return json({ nonsense: true });
    return json({ Response: 'True' });
  } });
  await assert.rejects(client.search('A'), { message: 'Appel OMDb impossible' });
  await assert.rejects(client.search('A'), UpstreamError);
  await assert.rejects(client.search('A'), /invalide/);
  await client.search('A');
  assert.equal(client.budget().used, 4);
  assert.deepEqual(db.prepare('SELECT status FROM api_log ORDER BY id').all().map(r => r.status), [0, 503, 200, 200]);
  const missing = new OmdbClient(db, { apiKey: '' });
  await assert.rejects(missing.search('nouveau'), ConfigurationError);
  assert.equal(db.prepare('SELECT count(*) AS n FROM api_log').get()!.n, 4);
});

test('budget : réservations concurrentes et dédoublonnage des appels simultanés', async t => {
  const db = tempDb(t); let calls = 0;
  const client = new OmdbClient(db, { apiKey: 'test', dailyBudget: 1,
    fetch: async () => { calls++; return json({ Response: 'True' }); } });
  await Promise.all([client.search('A'), client.search('A'), client.search('A')]);
  assert.equal(calls, 1);
  const other = new OmdbClient(db, { apiKey: 'test', dailyBudget: 2,
    fetch: async () => { calls++; return json({ Response: 'True' }); } });
  const results = await Promise.allSettled([other.search('B'), other.search('C')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(calls, 2); assert.equal(other.budget().used, 2);
});

test('OMDb : résultats négatifs cachés, refus fournisseur non cachés et configuration validée', async t => {
  const db = tempDb(t); let calls = 0;
  const client = new OmdbClient(db, { apiKey: 'test', dailyBudget: 20, fetch: async input => {
    calls++;
    const query = new URL(String(input)).searchParams.get('s');
    return json({ Response: 'False', Error: query === 'quota' ? 'Request limit reached!' : query === 'key' ? 'Invalid API key!' : 'Movie not found!' });
  } });
  assert.equal((await client.search('absent')).Response, 'False');
  await client.search('absent'); assert.equal(calls, 1);
  await assert.rejects(client.search('quota'), BudgetExceeded);
  await assert.rejects(client.search('quota'), BudgetExceeded);
  await assert.rejects(client.search('key'), ConfigurationError);
  assert.equal(calls, 4);
  assert.throws(() => new OmdbClient(db, { dailyBudget: NaN }));
  assert.throws(() => new OmdbClient(db, { dailyBudget: -1 }));
});
