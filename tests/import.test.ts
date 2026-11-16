import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { tempDb, tempDir } from './helpers.ts';
import { importXlsx } from '../scripts/import-xlsx.ts';
import { FilmsRepo } from '../server/repo/films.ts';
import { parseExcelDate, parseScore, parseTitle } from '../server/import/parse.ts';
import { migrate } from '../server/db/index.ts';

test('migration versionnée, seed et contraintes SQLite', t => {
  const db = tempDb(t);
  migrate(db);
  const repo = new FilmsRepo(db);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 3);
  assert.deepEqual(repo.viewers().map(v => [v.name, v.is_core]), [['Fleur', true], ['Noé', true]]);
  assert.equal(repo.tags()[0]!.label, '+1'); assert.equal(repo.tags()[0]!.emoji, '😭');
  const film = repo.create({ title: 'Contraintes' });
  assert.throws(() => repo.setRatings(film.id, [{ viewer_id: 1, score: 11 }]));
  assert.throws(() => repo.setRatings(film.id, [{ viewer_id: 999, score: 1 }]));
  assert.throws(() => repo.setTags(film.id, [999]));
});

test('classeur réel : chaque ligne, chaque note, moyennes F et idempotence', async t => {
  const path = 'data/source/filmsvus.xlsx';
  const db = tempDb(t), repo = new FilmsRepo(db);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path);
  const sheet = workbook.getWorksheet('Liste')!;
  // ExcelJS drops zero cached formula results. Read F's actual <v> from the ZIP
  // as an independent oracle rather than silently skipping those four rows.
  const zip = await JSZip.loadAsync(await readFile(path));
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  const cachedAverages = new Map<number, number>();
  for (const match of xml.matchAll(/<c\b[^>]*\br="F(\d+)"[^>]*>([\s\S]*?)<\/c>/g)) {
    const value = /<v>([-+\d.eE]+)<\/v>/.exec(match[2]!);
    if (value) cachedAverages.set(Number(match[1]), Number(value[1]));
  }
  const first = await importXlsx(db, path);
  const films = repo.list();
  let count = 0, compared = 0;
  sheet.eachRow((row, index) => {
    if (index === 1 || row.getCell(1).value === null) return;
    count++;
    const title = parseTitle(row.getCell(1).value), date = parseExcelDate(row.getCell(3).value);
    const film = films.find(f => f.title === title && f.watched_at === date);
    assert.ok(film, `ligne ${index} importée`);
    for (const [col, name] of [[4, 'Fleur'], [5, 'Noé']] as const) {
      const score = parseScore(row.getCell(col).value);
      assert.equal(film.ratings.find(r => r.name === name)!.score, score, `ligne ${index} ${name}`);
    }
    if (parseScore(row.getCell(4).value) !== null && parseScore(row.getCell(5).value) !== null) {
      assert.ok(cachedAverages.has(index), `résultat F${index} présent dans le XML`);
      const rawScores = [4, 5].map(col => Number(row.getCell(col).value));
      if (rawScores.every(score => Number.isInteger(score) && score >= 0)) {
        assert.ok(Math.abs(film.avg! - cachedAverages.get(index)!) < 1e-9, `moyenne F${index}`);
      }
      const scores = [4, 5].map(col => parseScore(row.getCell(col).value)!);
      assert.equal(film.avg, (scores[0]! + scores[1]!) / 2, `moyenne normalisée ${index}`);
      compared++;
    }
  });
  assert.ok(compared > 300);
  assert.equal(films.length, count); assert.equal(first.imported, count);
  assert.ok(films.some(f => f.title === '1917'));
  const chosen = films[0]!;
  repo.patch(chosen.id, { hydrated_at: '2026-11-11T00:00:00Z', genres: ['Drama'] });
  repo.setTags(chosen.id, [1]);
  const second = await importXlsx(db, path);
  assert.equal(second.inserted, 0); assert.equal(second.updated, count);
  assert.equal(repo.list().length, count);
  assert.equal(repo.get(chosen.id).hydrated, true);
  assert.deepEqual(repo.get(chosen.id).genres, ['Drama']);
  assert.equal(repo.get(chosen.id).tags.length, 1);
  t.diagnostic(`${count} films, ${compared} moyennes normalisées contrôlées (zéros inclus)`);
});

test('import synthétique : ignore F et I à L, utilise caches, annotations et rollback', async t => {
  const db = tempDb(t), path = join(tempDir(t), 'source.xlsx');
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Liste');
  sheet.addRow(['Titre', 'Real', 'Date', 'Note Fleur', 'Note Noé', 'Note Moyenne', 'Résumé', 'Commentaire', 'Note Etienne', 'Letterboxd', 'Letterboxed note', 'Ecart']);
  sheet.addRow([1917, 'Maïmouna Doucouré (pedo)', 46326.49, { formula: '1-4', result: -3 }, '-', 999,
    'Résumé', 'Commentaire', 9, 'à revoir', 999, 999]);
  sheet.addRow(['Zéro calculé', '', 46327, { formula: '1-1', result: 0 }, 2]);
  workbook.addWorksheet('Logs').addRow(['ignoré']);
  await workbook.xlsx.writeFile(path);
  await importXlsx(db, path);
  const films = new FilmsRepo(db).list(), film = films.find(f => f.title === '1917')!;
  assert.equal(film.title, '1917'); assert.equal(film.director_text, 'Maïmouna Doucouré (pedo)');
  assert.equal(film.avg, 0); assert.equal(film.gap, null);
  assert.equal(film.comment, 'Commentaire');
  assert.equal(film.ratings.length, 2);
  assert.equal(films.find(f => f.title === 'Zéro calculé')!.avg, 1);
  sheet.addRow(['Film invalide', '', 46326, 11]);
  await workbook.xlsx.writeFile(path);
  await assert.rejects(importXlsx(db, path), /Ligne 4/);
  assert.equal(new FilmsRepo(db).list().length, 2);
});
