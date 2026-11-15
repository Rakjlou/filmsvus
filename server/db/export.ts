import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface DataManifest {
  format: 1;
  created_at: string;
  user_version: number;
  films: number;
  posters: number;
  sha256: { 'films.db': string };
}

export function inspectDatabase(dbPath: string) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') {
      throw new Error('Database integrity check failed.');
    }
    return {
      user_version: Number(db.prepare('PRAGMA user_version').get()!.user_version),
      films: Number(db.prepare('SELECT count(*) AS n FROM films').get()!.n),
      filmsWithPoster: Number(db.prepare("SELECT count(*) AS n FROM films WHERE poster_path IS NOT NULL AND poster_path <> ''").get()!.n),
    };
  } finally { db.close(); }
}

export function exportData({ dbPath, postersDir, outDir, now = new Date() }: {
  dbPath: string; postersDir: string; outDir: string; now?: Date;
}) {
  const createdAt = now.toISOString();
  // All archive names use UTC, like created_at in the manifest.
  const stamp = createdAt.slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const dir = resolve(outDir, `filmsvus-data-${stamp}`);
  mkdirSync(resolve(outDir), { recursive: true, mode: 0o700 });
  mkdirSync(dir, { mode: 0o700 }); // Refuse a collision, never overwrite an export.
  try {
    const copyPath = join(dir, 'films.db');
    const source = new DatabaseSync(dbPath, { readOnly: true });
    try {
      source.exec('PRAGMA busy_timeout = 5000');
      source.exec(`VACUUM INTO '${copyPath.replaceAll("'", "''")}'`);
    } finally { source.close(); }
    chmodSync(copyPath, 0o600);
    const { user_version, films, filmsWithPoster } = inspectDatabase(copyPath);
    mkdirSync(join(dir, 'posters'), { mode: 0o700 });
    let entries: Dirent[];
    try { entries = readdirSync(postersDir, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      entries = [];
    }
    let posters = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !/^[A-Za-z0-9._-]+$/.test(entry.name)) continue;
      const target = join(dir, 'posters', entry.name);
      copyFileSync(join(postersDir, entry.name), target);
      chmodSync(target, 0o600);
      posters++;
    }
    const manifest: DataManifest = {
      format: 1, created_at: createdAt, user_version, films, posters,
      sha256: { 'films.db': createHash('sha256').update(readFileSync(copyPath)).digest('hex') },
    };
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    return { dir, manifest, filmsWithPoster };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
