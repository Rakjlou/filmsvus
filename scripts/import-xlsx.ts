import ExcelJS from 'exceljs';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, transaction } from '../server/db/index.ts';
import { excelCellValue, parseTitle, parseText, parseScore, parseExcelDate, parseLetterboxd } from '../server/import/parse.ts';

export async function importXlsx(db: DatabaseSync, path = 'data/source/filmsvus.xlsx') {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.getWorksheet('Liste');
  if (!sheet) throw new Error('Feuille Liste introuvable');
  const expected = ['Titre', 'Real', 'Date', 'Note Fleur', 'Note Noé'];
  expected.forEach((header, i) => {
    if (parseText(sheet.getRow(1).getCell(i + 1).value) !== header) throw new Error(`Colonne ${i + 1} inattendue`);
  });
  const viewers = db.prepare('SELECT id,name FROM viewers').all();
  const viewerId = (name: string) => Number(viewers.find(v => v.name === name)!.id);
  return transaction(db, () => {
    const summary = { imported: 0, inserted: 0, updated: 0, guest_ratings: 0, negative_ratings: 0, skipped: 0 };
    const upsert = db.prepare(`INSERT INTO films(title,watched_at,director_text,summary,comment,letterboxd_url)
      VALUES (?,?,?,?,?,?) ON CONFLICT(title,watched_at) DO UPDATE SET
      director_text=excluded.director_text,summary=excluded.summary,comment=excluded.comment,
      letterboxd_url=excluded.letterboxd_url,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') RETURNING id`);
    const rating = db.prepare(`INSERT INTO ratings(film_id,viewer_id,score) VALUES (?,?,?)
      ON CONFLICT(film_id,viewer_id) DO UPDATE SET score=excluded.score`);
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const value = (column: number) => excelCellValue(row.getCell(column));
      if (!parseText(value(1))) { summary.skipped++; return; }
      try {
        const title = parseTitle(value(1));
        const watchedAt = parseExcelDate(value(3), workbook.properties.date1904);
        const link = parseLetterboxd(value(10));
        const comment = [parseText(value(8)), link.comment].filter(Boolean).join('\n') || null;
        const exists = db.prepare('SELECT id FROM films WHERE title=? AND watched_at=?').get(title, watchedAt);
        const film = upsert.get(title, watchedAt, parseText(value(2)),
          parseText(value(7)), comment, link.url)!;
        // Derived columns F, K, L are deliberately never read.
        for (const [column, name] of [[4, 'Fleur'], [5, 'Noé'], [9, 'Etienne']] as const) {
          const score = parseScore(value(column));
          rating.run(film.id!, viewerId(name), score);
          if (name === 'Etienne' && score !== null) summary.guest_ratings++;
          if (score !== null && score < 0) summary.negative_ratings++;
        }
        summary.imported++;
        if (exists) summary.updated++; else summary.inserted++;
      } catch (error) {
        throw new Error(`Ligne ${number} : ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    });
    return summary;
  });
}

if (import.meta.main) {
  const db = openDatabase();
  try { console.log('Import Liste :', await importXlsx(db, process.argv[2])); }
  finally { db.close(); }
}
