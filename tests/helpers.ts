import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { openDatabase } from '../server/db/index.ts';
import type { Fetch } from '../server/services/network.ts';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { addUser } from '../server/services/users.ts';
import { buildApp } from '../server/index.ts';
import { FilmsRepo } from '../server/repo/films.ts';

export function testApp(t: TestContext, options: Parameters<typeof buildApp>[0] = {}) {
  const db = options.db ?? tempDb(t);
  const app = buildApp({ db, fetch: offline, postersDir: tempDir(t), backgroundHydration: false, ...options });
  t.after(() => app.close());
  let cookie: Promise<string> | undefined;
  async function authed(options: InjectOptions) {
    cookie ??= authenticatedCookie(app, db);
    return app.inject({ ...options, headers: { cookie: await cookie, ...options.headers } });
  }
  return { db, app, repo: new FilmsRepo(db), authed };
}

export const testScrypt = { N: 1024, r: 8, p: 1 };
export async function authenticatedCookie(app: FastifyInstance, db: DatabaseSync, username = `test-${randomBytes(6).toString('hex')}`) {
  const password = randomBytes(24).toString('base64url');
  await addUser(db, username, password, testScrypt);
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  if (response.statusCode !== 200) throw new Error(`Test login failed: ${response.body}`);
  return String(response.headers['set-cookie']).split(';')[0]!;
}

export function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'filmsvus-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
export function tempDb(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'filmsvus-'));
  const db = openDatabase(join(dir, 'test.db'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return db;
}
export const offline: Fetch = async () => { throw new Error('Appel réseau non simulé'); };
// A forgotten injection must never reach the real OMDb quota during tests.
globalThis.fetch = offline;
export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
