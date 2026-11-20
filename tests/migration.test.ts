import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrate, openDatabase, SUPPORTED_DB_VERSION } from '../server/db/index.ts';

function legacyDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  // schema.sql deliberately remains the v1 bootstrap; all new DBs run v2 too.
  db.exec(readFileSync(new URL('../server/db/schema.sql', import.meta.url), 'utf8'));
  db.exec(`PRAGMA user_version=1;
    INSERT INTO viewers(id,name,is_core) VALUES (3,'Etienne',0);
    INSERT INTO films(id,title,watched_at,letterboxd_url,summary,comment)
      VALUES (1,'Film historique','2026-01-01T12:00:00Z','https://letterboxd.com/film/test/','Résumé','Souvenir');
    INSERT INTO films(id,title,watched_at) VALUES (2,'Autre film','2026-01-02T12:00:00Z');
    INSERT INTO ratings VALUES (1,1,-3),(1,2,7.5),(1,3,9),(2,1,NULL),(2,2,6.4);
    INSERT INTO film_tags VALUES (1,1);
    INSERT INTO credits VALUES (1,'director','Réalisatrice',0,'manual');`);
  return db;
}
const schema = (db: DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();

test('migration v1 → v2 : nettoyage, scores entiers, souvenirs conservés et schéma identique à une base neuve', t => {
  const db = legacyDatabase(), fresh = openDatabase(':memory:');
  t.after(() => { db.close(); fresh.close(); });
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, SUPPORTED_DB_VERSION);
  assert.deepEqual(db.prepare('SELECT name FROM viewers ORDER BY id').all().map(row => row.name), ['Fleur', 'Noé']);
  assert.deepEqual(db.prepare('SELECT film_id,viewer_id,score FROM ratings ORDER BY film_id,viewer_id').all().map(row => [...Object.values(row)]),
    [[1, 1, 0], [1, 2, 8], [2, 1, null], [2, 2, 6]]);
  const columns = db.prepare('PRAGMA table_info(films)').all().map(row => row.name);
  assert.ok(!columns.includes('letterboxd_url')); assert.ok(columns.includes('plot_fr'));
  assert.equal(db.prepare('SELECT plot_fr FROM films WHERE id=1').get()!.plot_fr, null);
  assert.equal(db.prepare('SELECT summary,comment FROM films WHERE id=1').get()!.comment, 'Souvenir');
  assert.equal(db.prepare('SELECT count(*) AS n FROM film_tags').get()!.n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM credits').get()!.n, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const score of [-1, 11, 7.5]) assert.throws(() => db.prepare('INSERT OR REPLACE INTO ratings VALUES (1,1,?)').run(score), /CHECK/);
  for (const score of [0, 10, null]) db.prepare('INSERT OR REPLACE INTO ratings VALUES (1,1,?)').run(score);
  assert.deepEqual(schema(db), schema(fresh));
  assert.equal(fresh.prepare('PRAGMA user_version').get()!.user_version, SUPPORTED_DB_VERSION);
  assert.deepEqual(fresh.prepare('SELECT name FROM viewers ORDER BY id').all().map(row => row.name), ['Fleur', 'Noé']);
  fresh.exec("INSERT INTO films(id,title,watched_at) VALUES (1,'Neuf','2026-01-01T00:00:00Z')");
  for (const score of [-1, 11, 7.5]) assert.throws(() => fresh.prepare('INSERT INTO ratings VALUES (1,1,?)').run(score), /CHECK/);
  const before = schema(db); migrate(db); assert.deepEqual(schema(db), before);
});

test('migration v2 → v3 : films, notes, tags, cache préservés et comptes identiques à une base neuve', t => {
  const db = openDatabase(':memory:'), fresh = openDatabase(':memory:');
  t.after(() => { db.close(); fresh.close(); });
  db.exec(`DROP TABLE rerate_scores; DROP TABLE rerates; DROP TABLE sessions; DROP TABLE users; PRAGMA user_version=2;
    INSERT INTO films(id,title,watched_at,summary,comment,plot_fr) VALUES (1,'Séance','2026-01-01','Résumé','Souvenir','Synopsis');
    INSERT INTO ratings VALUES (1,1,0),(1,2,9);
    INSERT INTO film_tags VALUES (1,1);
    INSERT INTO credits VALUES (1,'director','Réalisatrice',0,'manual');
    INSERT INTO api_log(provider,request_key,status,at,raw_response) VALUES ('omdb','test',200,'2026-01-01','{}');`);
  const tables = ['films', 'ratings', 'film_tags', 'tags', 'credits', 'api_log', 'viewers'];
  const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, SUPPORTED_DB_VERSION);
  assert.deepEqual(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()), before);
  assert.deepEqual(schema(db), schema(fresh));
  for (const current of [db, fresh]) {
    assert.deepEqual(current.prepare('SELECT * FROM users').all(), []);
    assert.deepEqual(current.prepare('SELECT * FROM sessions').all(), []);
    current.exec("INSERT INTO users(username,password_hash,created_at) VALUES ('noe','test-hash','2026-01-01')");
    assert.throws(() => current.exec("INSERT INTO users(username,password_hash,created_at) VALUES ('NOE','test-hash','2026-01-01')"), /UNIQUE/);
    current.exec("INSERT INTO sessions VALUES ('token-hash',1,'2026-01-01','2026-02-01')");
    assert.throws(() => current.exec("INSERT INTO sessions VALUES ('other-hash',999,'2026-01-01','2026-02-01')"), /FOREIGN KEY/);
    current.exec('DELETE FROM users WHERE id=1');
    assert.deepEqual(current.prepare('SELECT * FROM sessions').all(), []);
    assert.deepEqual(current.prepare('PRAGMA foreign_key_check').all(), []);
    assert.ok(current.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='sessions_expires_at'").get());
  }
  const migrated = schema(db); migrate(db); assert.deepEqual(schema(db), migrated);
});

test('migration v2 atomique et versions futures refusées', t => {
  const db = legacyDatabase(); t.after(() => db.close());
  db.exec("CREATE TRIGGER prevent_viewer_delete BEFORE DELETE ON viewers BEGIN SELECT RAISE(ABORT,'blocked'); END");
  assert.throws(() => migrate(db), /blocked/);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1);
  assert.equal(db.prepare('SELECT score FROM ratings WHERE viewer_id=3').get()!.score, 9);
  assert.equal(db.prepare('SELECT score FROM ratings WHERE viewer_id=1 AND film_id=1').get()!.score, -3);
  db.exec(`DROP TRIGGER prevent_viewer_delete; PRAGMA user_version=${SUPPORTED_DB_VERSION + 1}`);
  const before = schema(db);
  assert.throws(() => migrate(db), /non prise en charge/); assert.deepEqual(schema(db), before);
});

test('migration v3 → v4 : données et sessions préservées, tables contraintes et migration idempotente', t => {
  const db = openDatabase(':memory:'), fresh = openDatabase(':memory:');
  t.after(() => { db.close(); fresh.close(); });
  db.exec(`DROP TABLE rerate_scores; DROP TABLE rerates; PRAGMA user_version=3;
    INSERT INTO films(id,title,watched_at,summary) VALUES (1,'Souvenir','2020-01-01','Résumé');
    INSERT INTO ratings VALUES (1,1,7),(1,2,NULL);
    INSERT INTO film_tags VALUES (1,1);
    INSERT INTO users VALUES (1,'test','hash','2026-01-01');
    INSERT INTO sessions VALUES ('hash',1,'2026-01-01','2026-12-01');`);
  const tables = ['films', 'ratings', 'viewers', 'tags', 'film_tags', 'users', 'sessions'];
  const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 4);
  assert.deepEqual(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()), before);
  assert.deepEqual(schema(db), schema(fresh));
  assert.deepEqual(db.prepare('SELECT * FROM rerates').all(), []);
  assert.deepEqual(db.prepare('SELECT * FROM rerate_scores').all(), []);
  assert.throws(() => db.exec("INSERT INTO rerates VALUES (1,'other','2026-01-01')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO rerates VALUES (999,'ignored','2026-01-01')"), /FOREIGN KEY/);
  db.exec("INSERT INTO rerates VALUES (1,'rated','2026-01-01')");
  for (const score of [-1, 11, 2.5, null]) {
    assert.throws(() => db.prepare('INSERT INTO rerate_scores VALUES (1,1,?)').run(score), /CHECK|NOT NULL/);
  }
  assert.throws(() => db.exec('INSERT INTO rerate_scores VALUES (1,999,5)'), /FOREIGN KEY/);
  db.exec('INSERT INTO rerate_scores VALUES (1,1,0),(1,2,10)');
  migrate(db);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rerate_scores').get()!.n, 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('migration v4 atomique : une erreur de création annule les deux tables et la version', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  db.exec('DROP TABLE rerate_scores; DROP TABLE rerates; PRAGMA user_version=3; CREATE TABLE rerate_scores(blocked TEXT)');
  assert.throws(() => migrate(db), /already exists/);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 3);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='rerates'").get(), undefined);
});
