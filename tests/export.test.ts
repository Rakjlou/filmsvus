import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { exportData, inspectDatabase } from '../server/db/export.ts';
import { openDatabase, SUPPORTED_DB_VERSION } from '../server/db/index.ts';
import { checkDatabase } from '../scripts/check-db.ts';
import { FilmsRepo } from '../server/repo/films.ts';
import { ReratesRepo } from '../server/repo/rerates.ts';
import { tempDir } from './helpers.ts';

const now = new Date('2026-11-15T15:04:03Z');

test('export: coherent snapshot of an open WAL database, safe posters and manifest', t => {
  // Hooks run in registration order: close SQLite before tempDir removes its files on Windows.
  t.after(() => db.close());
  const root = tempDir(t), dbPath = join(root, 'source.db'), postersDir = join(root, 'images');
  const db = openDatabase(dbPath);
  const repo = new FilmsRepo(db);
  const rated = repo.create({ title: 'Avec affiche', watched_at: '2020-01-01T00:00:00Z', poster_path: 'tt1234567.jpg' });
  const ignored = repo.create({ title: 'Sans affiche', watched_at: '2020-01-02T00:00:00Z' });
  const rerates = new ReratesRepo(repo, () => now.getTime());
  rerates.rate(rated.id, { 1: 8, 2: 5 });
  rerates.ignore(ignored.id);
  db.exec("INSERT INTO api_log(provider,request_key,status,at,raw_response) VALUES ('omdb','test',200,'2026-11-15','{}')");
  assert.ok(existsSync(`${dbPath}-wal`));
  const before = db.prepare('SELECT * FROM films ORDER BY id').all();
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  mkdirSync(postersDir);
  for (const name of ['tt1234567.jpg', '.hidden_file-2', 'invalid name.jpg']) writeFileSync(join(postersDir, name), name);
  mkdirSync(join(postersDir, 'subdirectory'));
  writeFileSync(join(postersDir, 'subdirectory', 'ignored.jpg'), 'ignored');
  // Both a quote and spaces exercise the SQL literal and archive path handling.
  const outDir = join(root, "export d'aujourd'hui");
  const result = exportData({ dbPath, postersDir, outDir, now });
  assert.equal(result.dir, join(outDir, 'filmsvus-data-20261115-150403'));
  assert.equal(result.filmsWithPoster, 1);
  assert.deepEqual(result.manifest, {
    format: 1, created_at: now.toISOString(), user_version: SUPPORTED_DB_VERSION,
    films: 2, posters: 2,
    sha256: { 'films.db': createHash('sha256').update(readFileSync(join(result.dir, 'films.db'))).digest('hex') },
  });
  assert.deepEqual(JSON.parse(readFileSync(join(result.dir, 'manifest.json'), 'utf8')), result.manifest);
  assert.deepEqual(readdirSync(join(result.dir, 'posters')).sort(), ['.hidden_file-2', 'tt1234567.jpg']);
  const copy = new DatabaseSync(join(result.dir, 'films.db'), { readOnly: true });
  try {
    assert.equal(copy.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    assert.deepEqual(copy.prepare('SELECT * FROM films ORDER BY id').all(), before);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM api_log').get()!.n, 1);
    for (const table of ['rerates', 'rerate_scores']) {
      assert.deepEqual(copy.prepare(`SELECT * FROM ${table} ORDER BY film_id`).all(), db.prepare(`SELECT * FROM ${table} ORDER BY film_id`).all());
    }
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
    repo.create({ title: 'Ajout après instantané' });
    assert.equal(copy.prepare('SELECT count(*) AS n FROM films').get()!.n, 2);
  } finally { copy.close(); }
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, SUPPORTED_DB_VERSION);
});

test('export: legacy source is not migrated, absent posters allowed, no overwrites', t => {
  const root = tempDir(t), dbPath = join(root, 'legacy.db'), postersDir = join(root, 'absent');
  const source = new DatabaseSync(dbPath);
  source.exec(readFileSync(new URL('../server/db/schema.sql', import.meta.url), 'utf8'));
  source.exec("PRAGMA user_version=1; INSERT INTO films(title,watched_at,letterboxd_url) VALUES ('Ancien','2020-01-01','souvenir')");
  source.close();
  const bytes = readFileSync(dbPath);
  const options = { dbPath, postersDir, outDir: join(root, 'exports'), now };
  const { manifest, dir } = exportData(options);
  assert.equal(manifest.user_version, 1);
  assert.equal(manifest.films, 1);
  assert.equal(manifest.posters, 0);
  assert.deepEqual(readFileSync(dbPath), bytes);
  const copy = new DatabaseSync(join(dir, 'films.db'), { readOnly: true });
  try { assert.equal(copy.prepare('SELECT letterboxd_url FROM films').get()!.letterboxd_url, 'souvenir'); }
  finally { copy.close(); }
  assert.throws(() => exportData(options), /EEXIST/);
  assert.ok(existsSync(join(dir, 'manifest.json')));
});

test('export and import validation: missing, corrupt and future databases fail without creating a source', t => {
  const root = tempDir(t), dbPath = join(root, 'missing.db'), outDir = join(root, 'exports');
  assert.throws(() => exportData({ dbPath, outDir, postersDir: root, now }));
  assert.ok(!existsSync(dbPath));
  assert.deepEqual(readdirSync(outDir), []);
  writeFileSync(dbPath, 'not a SQLite database');
  assert.throws(() => inspectDatabase(dbPath));
  const futurePath = join(root, 'future.db');
  const db = openDatabase(futurePath);
  db.exec(`PRAGMA user_version=${SUPPORTED_DB_VERSION + 1}`);
  db.close();
  assert.throws(() => checkDatabase(futurePath), /Unsupported database version/);
});

test('export CLI: real tar round trip, staging removed, existing archive preserved', t => {
  const tar = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  const code = (tar.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
    t.skip(`tar unavailable in this environment (${code})`);
    return;
  }
  assert.ifError(tar.error);
  assert.equal(tar.status, 0, tar.stderr);
  const root = tempDir(t), dbPath = join(root, 'source.db'), postersDir = join(root, 'posters');
  const db = openDatabase(dbPath);
  new FilmsRepo(db).create({ title: 'Film exporté', poster_path: 'tt1234567.jpg' });
  db.close();
  mkdirSync(postersDir);
  writeFileSync(join(postersDir, 'tt1234567.jpg'), 'poster');
  const script = resolve('scripts/export-data.ts');
  const outDir = join(root, 'exports with spaces');
  const env = { ...process.env, DB_PATH: dbPath, POSTERS_DIR: postersDir };
  const cli = spawnSync(process.execPath, [script, '--out', outDir], { env, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /scp ".+" rak:\/tmp\//);
  const files = readdirSync(outDir);
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^filmsvus-data-\d{8}-\d{6}\.tar\.gz$/);
  const archive = join(outDir, files[0]!);
  // Always give tar relative paths, including when testing on Windows with GNU tar.
  const listing = spawnSync('tar', ['-tzf', files[0]!], { cwd: outDir, encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /posters\/tt1234567.jpg/);
  const extracted = join(root, 'extracted');
  mkdirSync(extracted);
  const unpack = spawnSync('tar', ['-xzf', `../exports with spaces/${files[0]}`], { cwd: extracted, encoding: 'utf8' });
  assert.equal(unpack.status, 0, unpack.stderr);
  assert.equal(checkDatabase(join(extracted, 'films.db')).films, 1);
  assert.equal(readFileSync(join(extracted, 'posters', 'tt1234567.jpg'), 'utf8'), 'poster');
  const manifest = JSON.parse(readFileSync(join(extracted, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sha256['films.db'], createHash('sha256').update(readFileSync(join(extracted, 'films.db'))).digest('hex'));
  const before = readFileSync(archive);
  // Force a fixed timestamp via the testable entry point to exercise the archive collision.
  const fixed = `import { main } from ${JSON.stringify(new URL('../scripts/export-data.ts', import.meta.url).href)};
    const OriginalDate = Date; globalThis.Date = class extends OriginalDate { constructor() { super(${JSON.stringify(manifest.created_at)}); } };
    main(['--out', ${JSON.stringify(outDir)}]);`;
  const collision = spawnSync(process.execPath, ['--input-type=module', '-e', fixed], { env, encoding: 'utf8' });
  assert.notEqual(collision.status, 0);
  assert.deepEqual(readFileSync(archive), before);
  assert.deepEqual(readdirSync(outDir), files);
});
