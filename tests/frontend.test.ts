import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilmsRepo } from '../server/repo/films.ts';
import { tempDb } from './helpers.ts';
import { selectFilms, sorts } from '../web/listState.ts';
import { posterInitials } from '../web/format.ts';
import { stepRating } from '../web/rating.ts';
import { candidateSelection, normalizeCandidate } from '../web/search.ts';
import { dansMaPeau, knivesOut } from './fixtures/wikidata.ts';

test('affiches : initiales sans ponctuation, parenthèses ni mots purement numériques', () => {
  for (const [title, expected] of [
    ['Malveillante (Other Mommy)', 'MO'], ['[Été] — à Paris', 'ÉÀ'],
    ['... 123 (45) Blade Runner 2049', 'BR'], ['District 9', 'D'],
    ['B2 Plan', 'BP'], ['1917', 'FV'], [' ( [] ) — ', 'FV'], ['', 'FV'],
  ] as const) assert.equal(posterInitials(title), expected, title);
});

test('notes : premier pas à 5 dans les deux sens, demi-points, zéro et bornes préservés', () => {
  assert.equal(stepRating(null, 1), 5);
  assert.equal(stepRating(null, -1), 5);
  assert.equal(stepRating(5, 1), 5.5);
  assert.equal(stepRating(5, -1), 4.5);
  assert.equal(stepRating(0, -1), -.5);
  assert.equal(stepRating(-10, -1), -10);
  assert.equal(stepRating(10, 1), 10);
});

test('candidats : compatibilité OMDb et sélection en français conservant la casse saisie', () => {
  const legacy = normalizeCandidate({ imdbID: 'tt1234567', Title: 'Film', Year: '1999', Poster: 'N/A', Director: 'Alice, Bob' });
  assert.equal(legacy.title, 'Film'); assert.equal(legacy.year, 1999); assert.equal(legacy.poster, null);
  assert.deepEqual(legacy.directors, ['Alice', 'Bob']);
  const candidate = { imdbID: dansMaPeau.imdbID, title: dansMaPeau.titleFr!, originalTitle: dansMaPeau.originalTitle,
    englishTitle: dansMaPeau.titleEn, year: dansMaPeau.year, directors: dansMaPeau.directors, poster: null, source: 'wikidata' as const };
  assert.equal(candidateSelection(candidate, ' DANS MA PEAU ').title, 'DANS MA PEAU');
  assert.equal(candidateSelection(candidate, 'In My Skin').title, 'Dans ma peau');
  assert.equal(candidateSelection({ ...candidate, title: knivesOut.titleFr! }, 'A Couteaux Tirés').title, 'À couteaux tirés');
});

test('liste : recherche accent-insensible dans les souvenirs et le générique, filtres combinés, année Paris', t => {
  const repo = new FilmsRepo(tempDb(t));
  const film = repo.create({ title: 'Été', title_fr: 'Un été français', original_title: 'Summer in Paris', watched_at: '2025-12-31T23:30:00Z', director_text: 'Agnès Varda',
    summary: 'Une plage', comment: 'Mémorable', year: 1999, genres: ['Drame'], tag_ids: [1],
    credits: [{ role: 'composer', name: 'Éric Serra', position: 0, source: 'manual' }],
    ratings: [{ viewer_id: 1, score: -4 }, { viewer_id: 2, score: 6 }] });
  repo.create({ title: 'Autre', watched_at: '2025-01-01T00:00:00Z', hydrated_at: '2025-02-01T00:00:00Z' });
  const films = repo.list();
  for (const q of ['ete', 'francais', 'summer', 'agnes', 'plage', 'memorable', 'eric']) assert.deepEqual(selectFilms(films, new URLSearchParams({ q })).map(f => f.id), [film.id]);
  const params = new URLSearchParams({ year: '2026', decade: '1990', tag: '1', genre: 'Drame', director: 'Agnès Varda', min: '1', max: '1', gap: '10', unhydrated: '1' });
  assert.deepEqual(selectFilms(films, params).map(f => f.id), [film.id]);
  params.set('min', '1.5'); assert.equal(selectFilms(films, params).length, 0);
  assert.equal(selectFilms(films, new URLSearchParams('unrated=1')).length, 1);
  assert.equal(selectFilms(films, new URLSearchParams('max=-1')).length, 0);
  assert.equal(selectFilms(films, new URLSearchParams('gap=11')).length, 0);
});

test('liste : tous les tris, notes négatives, absences en dernier dans les deux sens, entrée préservée', t => {
  const repo = new FilmsRepo(tempDb(t));
  const first = repo.create({ title: 'A', watched_at: '2024-01-01T00:00:00Z', director_text: 'A', year: 1990,
    runtime_min: 90, imdb_rating: 3, metascore: 20, ratings: [{ viewer_id: 1, score: -4 }, { viewer_id: 2, score: -2 }] });
  const second = repo.create({ title: 'B', watched_at: '2025-01-01T00:00:00Z', director_text: 'B', year: 2000,
    runtime_min: 120, imdb_rating: 8, metascore: 90, ratings: [{ viewer_id: 1, score: 4 }, { viewer_id: 2, score: 8 }] });
  repo.db.prepare('UPDATE films SET created_at=? WHERE id=?').run('2024-01-01T00:00:00Z', first.id);
  repo.db.prepare('UPDATE films SET created_at=? WHERE id=?').run('2025-01-01T00:00:00Z', second.id);
  repo.create({ title: 'Z', watched_at: '2026-01-01T00:00:00Z' });
  const films = repo.list(), original = films.map(f => f.id);
  for (const [sort] of sorts) {
    const ascending = selectFilms(films, new URLSearchParams({ sort, dir: 'asc' }));
    const descending = selectFilms(films, new URLSearchParams({ sort, dir: 'desc' }));
    assert.equal(ascending[0]!.id, first.id, sort);
    assert.ok(descending.findIndex(f => f.id === second.id) < descending.findIndex(f => f.id === first.id), sort);
    if (!['title', 'watched_at', 'created_at'].includes(sort)) assert.equal(descending.at(-1)!.title, 'Z', sort);
  }
  assert.deepEqual(films.map(f => f.id), original);
  assert.equal(selectFilms(films, new URLSearchParams('sort=unknown&dir=broken'))[0]!.title, 'Z');
});
