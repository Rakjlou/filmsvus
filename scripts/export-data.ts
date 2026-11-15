import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, openSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { exportData } from '../server/db/export.ts';

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { out: { type: 'string', default: 'data/export' } } });
  const { dir, manifest, filmsWithPoster } = exportData({
    dbPath: process.env.DB_PATH ?? 'data/films.db',
    postersDir: process.env.POSTERS_DIR ?? 'data/posters',
    outDir: values.out!,
  });
  const name = `${basename(dir)}.tar.gz`;
  const archive = join(dirname(dir), name);
  let reserved = false;
  try {
    closeSync(openSync(archive, 'wx', 0o600));
    reserved = true;
    // Relative tar arguments work with both GNU tar (Git Bash) and Windows bsdtar.
    const result = spawnSync('tar', ['-czf', `../${name}`, 'films.db', 'manifest.json', 'posters'], {
      cwd: dir, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`tar failed (${result.status ?? result.signal}).`);
    chmodSync(archive, 0o600);
    console.log(`Archive : ${archive} (${statSync(archive).size} octets)`);
    console.log(`${manifest.films} film(s), ${manifest.posters} fichier(s) d’affiche, ${filmsWithPoster} film(s) avec affiche ; schéma v${manifest.user_version}. Horodatage UTC.`);
    console.log(`scp "${archive}" rak:/tmp/`);
    return { archive, manifest };
  } catch (error) {
    if (reserved) rmSync(archive, { force: true });
    throw error;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (import.meta.main) {
  try { main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
