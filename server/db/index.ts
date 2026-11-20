import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const SUPPORTED_DB_VERSION = 4;

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function migrate(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (version > SUPPORTED_DB_VERSION) throw new Error(`Version de base non prise en charge : ${version}`);
  if (version === 0) transaction(db, () => {
    db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    db.exec('PRAGMA user_version = 1');
  });
  if (version < 2) transaction(db, () => {
    db.exec(`
      DELETE FROM ratings WHERE viewer_id IN (SELECT id FROM viewers WHERE is_core=0);
      DELETE FROM viewers WHERE is_core=0;
      UPDATE ratings SET score=round(max(0,score)) WHERE score IS NOT NULL;
      CREATE TABLE ratings_v2 (
        film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
        viewer_id INTEGER NOT NULL REFERENCES viewers(id),
        score INTEGER CHECK(score IS NULL OR (typeof(score)='integer' AND score BETWEEN 0 AND 10)),
        PRIMARY KEY(film_id, viewer_id)
      );
      INSERT INTO ratings_v2 SELECT film_id,viewer_id,score FROM ratings;
      DROP TABLE ratings;
      ALTER TABLE ratings_v2 RENAME TO ratings;
      CREATE INDEX ratings_viewer ON ratings(viewer_id);
      ALTER TABLE films DROP COLUMN letterboxd_url;
      ALTER TABLE films ADD COLUMN plot_fr TEXT;
      PRAGMA user_version = 2;
    `);
  });
  if (version < 3) transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
      PRAGMA user_version = 3;
    `);
  });
  if (version < 4) transaction(db, () => {
    db.exec(`
      CREATE TABLE rerates (
        film_id INTEGER PRIMARY KEY REFERENCES films(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('rated','ignored')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE rerate_scores (
        film_id INTEGER NOT NULL REFERENCES rerates(film_id) ON DELETE CASCADE,
        viewer_id INTEGER NOT NULL REFERENCES viewers(id),
        score INTEGER NOT NULL CHECK(typeof(score)='integer' AND score BETWEEN 0 AND 10),
        PRIMARY KEY(film_id, viewer_id)
      );
      PRAGMA user_version = 4;
    `);
  });
}

export function openDatabase(path = process.env.DB_PATH ?? 'data/films.db'): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
