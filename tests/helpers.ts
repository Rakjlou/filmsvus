import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { openDatabase } from '../server/db/index.ts';
import type { Fetch } from '../server/services/network.ts';

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
