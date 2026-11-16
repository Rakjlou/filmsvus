import type { Film } from './types.ts';
import { watchedYear } from './format.ts';
import { displayTitles } from './titles.ts';

export const sorts = [
  ['watched_at', 'Date de visionnage'], ['title', 'Titre'], ['avg', 'Note moyenne'], ['fleur', 'Note Fleur'],
  ['noe', 'Note Noé'], ['gap', 'Écart des notes'], ['year', 'Année de sortie'], ['runtime_min', 'Durée'],
  ['imdb_rating', 'Note IMDb'], ['metascore', 'Metascore'], ['director_text', 'Réalisation'], ['created_at', 'Date d’ajout'],
] as const;
export const filterKeys = ['tag', 'genre', 'director', 'year', 'decade', 'min', 'max', 'unrated', 'unhydrated', 'gap'];
const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr');
export const personScore = (film: Film, name: string) => film.core_ratings.find(r => normalize(r.name) === normalize(name))?.score ?? null;
export const directorNames = (film: Film) => [...new Set([film.director_text, ...film.credits.filter(c => c.role === 'director').map(c => c.name)].filter((s): s is string => Boolean(s)))];
// API reloads replace film objects, so edited films naturally get fresh search text.
const searchTexts = new WeakMap<Film, string>();
function searchText(film: Film) {
  let text = searchTexts.get(film);
  if (text === undefined) {
    text = normalize([film.title, film.title_fr, film.original_title, film.director_text, film.summary, film.comment, ...film.credits.map(c => c.name)].join(' '));
    searchTexts.set(film, text);
  }
  return text;
}
export function selectFilms(films: Film[], params: URLSearchParams) {
  const query = normalize(params.get('q')?.trim() ?? '');
  const selectedTags = params.getAll('tag');
  const numericFilter = (key: string) => {
    const raw = params.get(key);
    return raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
  };
  const min = numericFilter('min'), max = numericFilter('max'), gap = numericFilter('gap');
  const result = films.filter(f => {
    if (query && !searchText(f).includes(query)) return false;
    if (selectedTags.some(id => !f.tags.some(tag => String(tag.id) === id))) return false;
    if (params.get('genre') && !f.genres.includes(params.get('genre')!)) return false;
    if (params.get('director') && !directorNames(f).includes(params.get('director')!)) return false;
    if (params.get('year') && watchedYear(f.watched_at) !== params.get('year')) return false;
    if (params.get('decade') && (f.year === null || String(Math.floor(f.year / 10) * 10) !== params.get('decade'))) return false;
    if (min !== null && (f.avg === null || f.avg < min)) return false;
    if (max !== null && (f.avg === null || f.avg > max)) return false;
    if (params.get('unrated') === '1' && f.avg !== null) return false;
    if (params.get('unhydrated') === '1' && f.hydrated) return false;
    if (gap !== null && (f.gap === null || f.gap < gap)) return false;
    return true;
  });
  const requested = params.get('sort');
  const sort = sorts.find(([key]) => key === requested)?.[0] ?? 'watched_at';
  const direction = params.get('dir') === 'asc' ? 1 : -1;
  const value = (f: Film) => sort === 'fleur' ? personScore(f, 'Fleur') : sort === 'noe' ? personScore(f, 'Noé') : sort === 'title' ? displayTitles(f).main : f[sort];
  return result.sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    if (av === null || bv === null) return b.id - a.id;
    return (typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv, 'fr', { numeric: true }) : Number(av) - Number(bv)) * direction || b.id - a.id;
  });
}
