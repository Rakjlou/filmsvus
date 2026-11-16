import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { openDatabase } from '../server/db/index.ts';
import { addUser, changePassword, createUsers, findUser, hashPassword, listUsers, removeUser, UserError, verifyPassword } from '../server/services/users.ts';
import { createAuth, sessionLifetime, tokenHash } from '../server/services/auth.ts';
import { authenticatedCookie, tempDb, tempDir, testScrypt, testApp } from './helpers.ts';

const password = randomBytes(24).toString('base64url');
const login = (username = 'noe', secret = password) => ({ method: 'POST' as const, url: '/api/auth/login', payload: { username, password: secret } });

test('scrypt : format autonome, sel aléatoire, paramètres stockés et vérification', async () => {
  const hash = await hashPassword(password);
  assert.match(hash, /^scrypt\$32768\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  const lowCost = await hashPassword(password, testScrypt);
  assert.equal(await verifyPassword(password, lowCost), true);
  assert.notEqual(lowCost, await hashPassword(password, testScrypt));
  for (const malformed of ['', 'plaintext', hash.replace('$32768$', '$999999999$'), hash.replace('$8$', '$999999$'),
    hash.replace('$1$', '$999999$'), hash.replace('$32768$', '$-1$'), hash + '$extra',
    hash.replace(/\$[^$]+$/, '$short'), hash.replace(/\$[^$]+$/, '$')]) {
    assert.equal(await verifyPassword(password, malformed), false);
  }
  for (const invalid of ['court', 'a'.repeat(1025)]) await assert.rejects(hashPassword(invalid, testScrypt), /10 et 1024/);
});

test('comptes CLI : validation, doublon insensible à la casse, changement et suppression révoquent les sessions', async t => {
  const db = tempDb(t);
  for (const username of ['x', 'éé', 'a b', 'x'.repeat(33)]) await assert.rejects(addUser(db, username, password, testScrypt), /Identifiant/);
  await addUser(db, 'Noe', password, testScrypt);
  await assert.rejects(addUser(db, 'noe', password, testScrypt), /UNIQUE/);
  assert.deepEqual(listUsers(db).map(user => user.username), ['Noe']);
  assert.ok(!('password_hash' in listUsers(db)[0]!));
  const user = findUser(db, 'NOE')!;
  const first = createAuth(db).createSession(user.id, Date.now());
  await assert.rejects(changePassword(db, 'noe', 'court', testScrypt));
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get()!.n, 1);
  await changePassword(db, 'noe', 'new-test-password', testScrypt);
  assert.equal(db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(tokenHash(first)), undefined);
  assert.equal(await verifyPassword(password, findUser(db, 'noe')!.password_hash), false);
  assert.equal(await verifyPassword('new-test-password', findUser(db, 'noe')!.password_hash), true);
  createAuth(db).createSession(user.id, Date.now()); removeUser(db, 'NOE');
  assert.deepEqual(listUsers(db), []);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get()!.n, 0);
  assert.throws(() => removeUser(db, 'missing'), /introuvable/);
  await assert.rejects(changePassword(db, 'missing', password, testScrypt), /introuvable/);
  assert.throws(() => removeUser(db, 'identifiant invalide'), UserError);
  await assert.rejects(changePassword(db, 'identifiant invalide', password, testScrypt),
    error => error instanceof UserError && error.message === 'Compte introuvable.');
});

test('authentification : un changement de hash ou une suppression pendant scrypt invalide la connexion', async t => {
  const db = tempDb(t), users = createUsers(db);
  for (const remove of [false, true]) {
    await addUser(db, 'noe', password, testScrypt);
    const pending = users.authenticate('noe', password);
    // The lookup has run; scrypt yields before the final credential re-check.
    if (remove) removeUser(db, 'noe');
    else db.prepare('UPDATE users SET password_hash=? WHERE username=?').run('changed-hash', 'noe');
    assert.equal(await pending, undefined);
    if (!remove) removeUser(db, 'noe');
  }
});

test('auth : login ok/ko, schémas bornés, me public, logout invalide le jeton', async t => {
  const { db, app } = testApp(t, { cookieSecure: false });
  await addUser(db, 'Noe', password, testScrypt);
  const anon = await app.inject('/api/auth/me');
  assert.deepEqual(anon.json(), { user: null }); assert.equal(anon.headers['cache-control'], 'no-store');
  for (const payload of [{}, { username: 'x', password }, { username: 'n'.repeat(33), password }, { username: 'noe', password: 'x'.repeat(1025) },
    { username: 'noe', password, extra: true }]) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload });
    assert.equal(response.statusCode, 400); assert.equal(response.headers['cache-control'], 'no-store');
  }
  for (const request of [login('noe', 'incorrect'), login('unknown')]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: 'Unauthorized', message: 'Identifiant ou mot de passe incorrect' });
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const response = await app.inject(login('NOE'));
  assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { user: { username: 'Noe' } });
  const setCookie = String(response.headers['set-cookie']), cookie = setCookie.split(';')[0]!;
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(setCookie.includes(attribute));
  assert.ok(!setCookie.includes('Secure'));
  const token = cookie.split('=')[1]!; assert.match(token, /^[\w-]{43}$/);
  const stored = db.prepare('SELECT * FROM sessions').get()!;
  assert.equal(stored.token_hash, tokenHash(token)); assert.ok(!JSON.stringify(stored).includes(token));
  assert.deepEqual((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json(), { user: { username: 'Noe' } });
  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
  assert.equal(logout.statusCode, 204); assert.ok(String(logout.headers['set-cookie']).includes('Max-Age=0'));
  assert.equal(logout.headers['cache-control'], 'no-store');
  assert.deepEqual((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json(), { user: null });
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode, 204);
});

test('cookies : Secure explicite et défaut production/environnement', async t => {
  const previous = process.env.COOKIE_SECURE;
  t.after(() => { if (previous === undefined) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = previous; });
  for (const [production, env, override, expected] of [
    [false, undefined, undefined, false], [true, undefined, undefined, true],
    [true, 'false', undefined, false], [false, 'true', undefined, true],
    [false, undefined, true, true], [true, undefined, false, false],
  ] as const) {
    if (env === undefined) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = env;
    const { db, app } = testApp(t, { production, cookieSecure: override, distDir: tempDir(t) });
    await addUser(db, 'noe', password, testScrypt);
    const response = await app.inject(login());
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    assert.equal(String(response.headers['set-cookie']).includes('; Secure'), expected);
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    assert.equal(String(logout.headers['set-cookie']).includes('; Secure'), expected);
  }
});

test('sessions : expiration refusée, renouvellement glissant après 15 jours, nettoyage au login', async t => {
  let now = Date.parse('2026-01-01T00:00:00Z');
  const { db, app } = testApp(t, { now: () => now });
  const cookie = await authenticatedCookie(app, db);
  const token = cookie.split('=')[1]!, hash = tokenHash(token);
  const expires = () => String(db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(hash)!.expires_at);
  const original = expires();
  now += 14 * 86400000;
  const early = await app.inject({ url: '/api/auth/me', headers: { cookie } });
  assert.equal(early.headers['set-cookie'], undefined); assert.equal(expires(), original);
  now += 2 * 86400000;
  const renewed = await app.inject({ url: '/api/auth/me', headers: { cookie } });
  assert.equal(renewed.statusCode, 200); assert.ok(renewed.headers['set-cookie']);
  assert.equal(expires(), new Date(now + sessionLifetime).toISOString());
  now += sessionLifetime + 1;
  for (const url of ['/api/search?q=X', '/api/omdb/budget']) assert.equal((await app.inject({ url, headers: { cookie } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/films', headers: { cookie }, payload: { title: 'Refusé' } })).statusCode, 401);
  assert.deepEqual((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json(), { user: null });
  await authenticatedCookie(app, db);
  assert.equal(db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash), undefined);
  for (const invalid of ['bad', 'a'.repeat(43), '%zz']) {
    assert.deepEqual((await app.inject({ url: '/api/auth/me', headers: { cookie: `filmsvus_session=${invalid}` } })).json(), { user: null });
  }
});

test('CLI réelle : stdin sans argument secret, liste sans hash, commande invalide sans création', t => {
  const path = join(tempDir(t), 'cli.db');
  const run = (args: string[], input = '') => spawnSync(process.execPath, ['scripts/user.ts', ...args], {
    env: { ...process.env, DB_PATH: path }, input, encoding: 'utf8', timeout: 10000,
  });
  const add = run(['add', 'noe'], `${password}\nignored second line\n`);
  const code = (add.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EPERM' || code === 'EACCES' || code === 'ENOENT') {
    t.skip(`Subprocesses unavailable in this environment (${code}); user functions are tested separately`); return;
  }
  assert.ifError(add.error);
  assert.equal(add.status, 0, add.stderr); assert.ok(!add.stdout.includes(password));
  assert.equal(add.stdout.trim(), 'Compte créé.');
  const list = run(['list']); assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /noe\t/); assert.ok(!list.stdout.includes('scrypt$'));
  const invalid = run(['add', 'another', 'not-an-allowed-argument']);
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /Usage/);
  const db = openDatabase(path);
  // Close explicitly: t.after hooks run in registration order, so the temp dir would be removed first (EPERM on Windows).
  try {
    assert.equal(listUsers(db).length, 1);
    const passwd = run(['passwd', 'noe'], `${password}\n`);
    assert.equal(passwd.status, 0, passwd.stderr);
    assert.equal(passwd.stdout.trim(), 'Mot de passe modifié. (sessions révoquées)');
    const remove = run(['remove', 'noe']);
    assert.equal(remove.status, 0, remove.stderr);
    assert.equal(remove.stdout.trim(), 'Compte supprimé.');
    assert.equal(listUsers(db).length, 0);
  } finally { db.close(); }
});

test('limite de connexion : 11 tentatives concurrentes donnent 10 réponses 401 et une 429', async t => {
  const { app } = testApp(t);
  const responses = await Promise.all(Array.from({ length: 11 }, (_, n) => app.inject(login(`unknown-${n}`))));
  assert.equal(responses.filter(response => response.statusCode === 401).length, 10);
  assert.equal(responses.filter(response => response.statusCode === 429).length, 1);
});

test('garde global : toutes les mutations existantes et futures refusent les anonymes ; GET publics', async t => {
  const { db, app, repo } = testApp(t);
  const film = repo.create({ title: 'Public', summary: 'Résumé personnel', comment: 'Commentaire personnel', tag_ids: [1], ratings: [{ viewer_id: 1, score: 7 }] });
  app.post('/api/future-mutation', async () => ({ ok: true }));
  const url = `/api/films/${film.id}`;
  for (const [method, path, payload] of [
    ['POST', '/api/films', { title: 'Refusé' }], ['PATCH', url, { comment: 'Refusé' }],
    ['DELETE', url, undefined], ['PUT', `${url}/ratings`, { ratings: [] }], ['PUT', `${url}/tags`, { tag_ids: [] }],
    ['POST', `${url}/hydrate`, undefined], ['POST', '/api/tags', { label: 'Refusé' }], ['POST', '/api/future-mutation', undefined],
  ] as const) {
    const response = await app.inject({ method, url: path, payload });
    assert.equal(response.statusCode, 401, `${method} ${path}`);
    assert.deepEqual(response.json(), { error: 'Unauthorized', message: 'Connexion requise' });
  }
  for (const path of ['/api/films', url, '/api/tags', '/api/viewers', '/api/stats', '/api/auth/me']) {
    for (const method of ['GET', 'HEAD'] as const) assert.equal((await app.inject({ method, url: path })).statusCode, 200, `${method} ${path}`);
  }
  const publicFilm = (await app.inject(url)).json();
  assert.equal(publicFilm.summary, 'Résumé personnel'); assert.equal(publicFilm.comment, 'Commentaire personnel');
  for (const path of ['/api/search?q=Public', '/api/omdb/budget']) {
    for (const method of ['GET', 'HEAD'] as const) assert.equal((await app.inject({ method, url: path })).statusCode, 401);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/unknown-mutation' })).statusCode, 401);
  const cookie = await authenticatedCookie(app, db);
  assert.equal((await app.inject({ method: 'POST', url: '/api/future-mutation', headers: { cookie } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/omdb/budget', headers: { cookie } })).statusCode, 200);
});

test('politiques par route : exceptions explicites et lecture de session réservée aux routes protégées/me', async t => {
  const { db, app } = testApp(t);
  app.get('/api/private-reading', { config: { auth: 'required' } }, async request => ({ user: request.user }));
  app.post('/api/public-write', { config: { auth: 'public' } }, async () => ({ ok: true }));
  const cookie = await authenticatedCookie(app, db);
  const lookup = t.mock.method(createAuth(db), 'findSession');
  for (const request of [
    { url: '/api/films' },
    { method: 'POST' as const, url: '/api/public-write' },
    { method: 'POST' as const, url: '/api/auth/login', payload: {} },
  ]) await app.inject({ ...request, headers: { cookie } });
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal((await app.inject('/api/private-reading')).statusCode, 401);
  const privateReading = await app.inject({ url: '/api/private-reading', headers: { cookie } });
  assert.ok(privateReading.json().user);
  assert.equal(lookup.mock.callCount(), 1);
  const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
  assert.ok(me.json().user);
  assert.equal(lookup.mock.callCount(), 2);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode, 204);
  assert.equal(lookup.mock.callCount(), 2);
});

test('CSRF : Origin invalide refusé ; Host et X-Forwarded-Host du proxy seulement', async t => {
  const { db, app, repo } = testApp(t), film = repo.create({ title: 'Origine' });
  const cookie = await authenticatedCookie(app, db);
  for (const origin of ['https://evil.example', 'null', 'invalid']) {
    const response = await app.inject({ method: 'PATCH', url: `/api/films/${film.id}`, headers: { cookie, host: 'films.example', origin }, payload: { comment: 'Refusé' } });
    assert.equal(response.statusCode, 403);
  }
  assert.equal(repo.get(film.id).comment, null);
  for (const headers of [{ cookie, host: 'films.example', origin: 'https://films.example' }, { cookie, host: 'films.example' }]) {
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/films/${film.id}`, headers, payload: { comment: 'Accepté' } })).statusCode, 200);
  }
  for (const remoteAddress of ['127.0.0.1', '::1', '198.51.100.10']) {
    const headers = { cookie, host: '127.0.0.1:3210', 'x-forwarded-host': 'films.example', origin: 'https://films.example' };
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout', remoteAddress, headers });
    assert.equal(response.statusCode, remoteAddress === '198.51.100.10' ? 403 : 204);
  }
  assert.equal((await app.inject({ ...login(), headers: { origin: 'https://evil.example' } })).statusCode, 403);
});

test('CSRF : une requête rejetée ne renouvelle pas une session proche de son expiration', async t => {
  let now = Date.parse('2026-01-01T00:00:00Z');
  const { db, app, repo } = testApp(t, { now: () => now });
  const film = repo.create({ title: 'Origine' }), cookie = await authenticatedCookie(app, db);
  const token = cookie.split('=')[1]!, sessions = createAuth(db);
  const original = sessions.findSession(token, now)!.expires_at;
  now += 16 * 86400000;
  const response = await app.inject({ method: 'PATCH', url: `/api/films/${film.id}`,
    headers: { cookie, host: 'films.example', origin: 'https://evil.example' }, payload: { comment: 'Refusé' } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'Forbidden', message: 'Origine de la requête non autorisée' });
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(sessions.findSession(token, now)!.expires_at, original);
  const accepted = await app.inject({ url: '/api/omdb/budget', headers: { cookie } });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.headers['cache-control'], 'no-store');
  assert.ok(accepted.headers['set-cookie']);
  assert.equal(sessions.findSession(token, now)!.expires_at, new Date(now + sessionLifetime).toISOString());
});

test('limite de connexion : 10 requêtes par IP sur 15 minutes, succès et corps invalides compris', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-01-01T00:00:00Z') });
  const { db, app } = testApp(t);
  await addUser(db, 'noe', password, testScrypt);
  for (let n = 0; n < 3; n++) {
    assert.equal((await app.inject({ ...login(), payload: {} })).statusCode, 400);
    assert.equal((await app.inject(login(`unknown-${n}`))).statusCode, 401);
  }
  let cookie = '';
  for (let n = 0; n < 4; n++) {
    const response = await app.inject(login());
    assert.equal(response.statusCode, 200);
    cookie = String(response.headers['set-cookie']).split(';')[0]!;
  }
  const blocked = await app.inject(login());
  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.json(), { error: 'TooManyRequests', message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' });
  assert.equal(blocked.headers['retry-after'], '900'); assert.equal(blocked.headers['cache-control'], 'no-store');
  assert.equal(blocked.headers['set-cookie'], undefined);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get()!.n, 4);
  // Exhausting login must leave public reading, authenticated writes and logout available.
  for (let n = 0; n < 11; n++) assert.equal((await app.inject('/api/films')).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/films', headers: { cookie }, payload: { title: 'Autorisé' } })).statusCode, 201);
  assert.equal((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode, 204);
  t.mock.timers.tick(15 * 60000 - 1);
  const stillBlocked = await app.inject(login());
  assert.equal(stillBlocked.statusCode, 429); assert.equal(stillBlocked.headers['retry-after'], '1');
  t.mock.timers.tick(1);
  assert.equal((await app.inject(login())).statusCode, 200);
});

test('limite de connexion : aucun verrouillage par identifiant entre des IP différentes', async t => {
  const { db, app } = testApp(t);
  await addUser(db, 'noe', password, testScrypt);
  for (let n = 0; n < 10; n++) {
    assert.equal((await app.inject({ ...login(n % 2 ? 'NOE' : 'noe', 'incorrect'), remoteAddress: `198.51.100.${n + 1}` })).statusCode, 401);
  }
  assert.equal((await app.inject({ ...login(), remoteAddress: '198.51.100.99' })).statusCode, 200);
});

test('proxy : X-Forwarded-For honoré uniquement pour loopback, limite IP non usurpable', async t => {
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '198.51.100.10']) {
    const { app } = testApp(t);
    app.get('/api/test-ip', async request => ({ ip: request.ip }));
    const response = await app.inject({ url: '/api/test-ip', remoteAddress, headers: { 'x-forwarded-for': '203.0.113.8' } });
    assert.equal(response.json().ip, remoteAddress === '198.51.100.10' ? remoteAddress : '203.0.113.8');
    for (let n = 0; n < 11; n++) {
      const response = await app.inject({ ...login(`unknown-${n}`), remoteAddress, headers: { 'x-forwarded-for': `203.0.113.${n + 1}` } });
      assert.equal(response.statusCode, remoteAddress === '198.51.100.10' && n === 10 ? 429 : 401);
    }
    if (remoteAddress !== '198.51.100.10') {
      // The same forwarded IP keeps its counter even when requests use another loopback proxy.
      for (let n = 1; n < 11; n++) {
        const response = await app.inject({ ...login(), remoteAddress: '::1', headers: { 'x-forwarded-for': '203.0.113.1' } });
        assert.equal(response.statusCode, n === 10 ? 429 : 401);
      }
    }
  }
});
