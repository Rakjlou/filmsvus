import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDb } from './helpers.ts';
import { FilmsRepo } from '../server/repo/films.ts';
import { computeStats, correlation } from '../server/repo/stats.ts';

test('stats vides et corrélation dégénérée', t => {
  const repo = new FilmsRepo(tempDb(t));
  const stats = computeStats([], repo.viewers());
  assert.equal(stats.total, 0); assert.equal(stats.avg, null); assert.equal(stats.hydration_rate, 0);
  assert.equal(stats.imdb_correlation, null);
  assert.deepEqual(stats.imdb_pairs, []);
  assert.deepEqual(stats.viewers[0]!.rating_distribution, {});
  assert.equal(correlation([[1, 2]]), null);
  assert.equal(correlation([[1, 2], [1, 3]]), null);
  assert.equal(correlation([[1, 2], [2, 1]]), -1);
});

test('stats couple uniquement, mois Paris, zéro, genres/décennies, classements', t => {
  const repo = new FilmsRepo(tempDb(t));
  repo.create({ title: 'A', watched_at: '2025-12-31T23:30:00Z', director_text: 'Un réal',
    ratings: [{ viewer_id: 1, score: 8 }, { viewer_id: 2, score: 6 }],
    year: 1999, genres: ['Drama'], hydrated_at: '2026-01-01T00:00:00Z', imdb_rating: 9 });
  repo.create({ title: 'B', watched_at: '2026-01-03T12:00:00Z', director_text: 'Un réal',
    ratings: [{ viewer_id: 1, score: 4 }, { viewer_id: 2, score: 0 }],
    year: 2001, genres: ['Comedy'], imdb_rating: 3 });
  repo.create({ title: 'Sans note', watched_at: '2026-02-01T00:00:00Z' });
  const stats = computeStats(repo.list(), repo.viewers());
  assert.equal(stats.total, 3); assert.equal(stats.rated, 2); assert.equal(stats.avg, 4.5);
  assert.deepEqual(stats.films_by_year, { 2026: 3 });
  assert.deepEqual(stats.films_by_month, { '2026-01': 2, '2026-02': 1 });
  assert.equal(stats.viewers[0]!.avg, 6); assert.equal(stats.viewers[1]!.avg, 3);
  assert.equal(stats.viewers.length, 2);
  assert.deepEqual(stats.viewers[0]!.rating_distribution, { '8': 1, '4': 1 });
  assert.deepEqual(stats.viewers[1]!.rating_distribution, { '6': 1, '0': 1 });
  assert.deepEqual(stats.imdb_pairs.map(p => [p.title, p.avg, p.imdb_rating]).sort(), [['A', 7, 9], ['B', 2, 3]]);
  assert.deepEqual(stats.rating_distribution, { '7': 1, '2': 1 });
  assert.equal(stats.top[0]!.title, 'A'); assert.equal(stats.flop[0]!.title, 'B');
  assert.equal(stats.disagreements[0]!.gap, 4);
  assert.deepEqual(stats.directors, [{ name: 'Un réal', count: 2, avg: 4.5 }]);
  assert.deepEqual(stats.genres, [{ name: 'Drama', count: 1, avg: 7 }]);
  assert.deepEqual(stats.decades, [{ name: '1990', count: 1, avg: 7 }]);
  assert.equal(stats.imdb_correlation, 1); assert.equal(stats.hydration_rate, 1 / 3);
});
