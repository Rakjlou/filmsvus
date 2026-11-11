import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedValue, excelCellValue, parseText, parseTitle, parseScore, parseExcelDate, ratingMetrics, parseLetterboxd } from '../server/import/parse.ts';

test('valeurs Excel : formules mises en cache, zéro, rich text et titres numériques', () => {
  assert.equal(cachedValue({ formula: '1-1', result: 0 }), 0);
  assert.equal(excelCellValue({ value: { formula: '1-1' }, result: 0 }), 0);
  assert.equal(excelCellValue({ value: 0 }), 0);
  assert.equal(cachedValue({ sharedFormula: 'D2', result: -3 }), -3);
  assert.equal(cachedValue({ formula: '1+1' }), null);
  assert.equal(cachedValue({ error: '#VALUE!' }), null);
  assert.equal(parseText({ richText: [{ text: 'Maïmouna ' }, { text: 'Doucouré (pedo)' }] }), 'Maïmouna Doucouré (pedo)');
  assert.equal(parseTitle(1917.0), '1917');
  assert.equal(parseTitle('1917.0'), '1917');
  assert.equal(parseText({ text: 'Texte', hyperlink: 'https://example.org' }), 'Texte');
  assert.throws(() => parseTitle(null));
});

test('notes : absences, notes négatives, décimales et bornes', () => {
  for (const value of [null, undefined, '', '-', ' - ']) assert.equal(parseScore(value), null);
  for (const value of [-10, -3, 0, 10, 7.75]) assert.equal(parseScore(value), value);
  assert.equal(parseScore('7,5'), 7.5);
  assert.equal(parseScore({ formula: '1-4', result: -3 }), -3);
  for (const value of [-10.1, 10.1, 'bonjour', Infinity]) assert.throws(() => parseScore(value));
});

test('dates Excel : heure fractionnaire, hiver/été Paris, indépendante du fuseau système', () => {
  assert.equal(parseExcelDate(46326.49), '2026-10-31T10:45:36.000Z');
  assert.equal(parseExcelDate(new Date('2018-08-30T00:00:00.000Z')), '2018-08-29T22:00:00.000Z');
  assert.equal(parseExcelDate(new Date('2026-01-01T00:00:00.000Z')), '2025-12-31T23:00:00.000Z');
  assert.equal(parseExcelDate({ formula: 'NOW()', result: new Date('2026-07-01T12:30:00Z') }), '2026-07-01T10:30:00.000Z');
  assert.equal(parseExcelDate(40729, true), parseExcelDate(42191));
  assert.equal(parseExcelDate(new Date('2026-10-25T02:30:00Z')), '2026-10-25T00:30:00.000Z');
  assert.throws(() => parseExcelDate(new Date('2026-03-29T02:30:00Z')), /inexistante/);
  assert.throws(() => parseExcelDate('pas une date'));
});

test('calculs dérivés : absences, négatifs, moyenne, écart et arrondi /5', () => {
  assert.deepEqual(ratingMetrics([7, 8]), { avg: 7.5, gap: 1, letterboxd_rating: 4 });
  assert.deepEqual(ratingMetrics([null, 8]), { avg: 8, gap: null, letterboxd_rating: 4 });
  assert.deepEqual(ratingMetrics([null, null]), { avg: null, gap: null, letterboxd_rating: null });
  assert.deepEqual(ratingMetrics([-10, -3]), { avg: -6.5, gap: 7, letterboxd_rating: -3 });
});

test('colonne J : URL, hyperlien ou texte préservé dans le commentaire', () => {
  assert.deepEqual(parseLetterboxd('https://letterboxd.com/film/1917/'), { url: 'https://letterboxd.com/film/1917/', comment: null });
  assert.equal(parseLetterboxd({ text: 'Ouvrir', hyperlink: 'https://letterboxd.com/film/1917/' }).url, 'https://letterboxd.com/film/1917/');
  assert.equal(parseLetterboxd({ formula: 'X1', result: 'https://letterboxd.com/' }).url, 'https://letterboxd.com/');
  assert.deepEqual(parseLetterboxd('pas de lien'), { url: null, comment: 'Letterboxd : pas de lien' });
  assert.equal(parseLetterboxd('javascript:alert(1)').url, null);
  assert.deepEqual(parseLetterboxd(null), { url: null, comment: null });
});
