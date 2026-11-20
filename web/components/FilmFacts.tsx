import type { Film } from '../types.ts';
import { number } from '../format.ts';

type Facts = Pick<Film, 'year' | 'runtime_min' | 'genres' | 'countries'>;
type Direction = Pick<Film, 'director_text' | 'credits'>;
type ExternalRatings = Pick<Film, 'imdb_rating' | 'metascore' | 'rt_score'>;

export function FilmFacts({ film, fallback = '' }: { film: Facts; fallback?: string }) {
  return <p className="film-facts">{[film.year, film.runtime_min ? `${film.runtime_min} min` : null,
    ...film.genres, ...film.countries].filter(Boolean).join(' · ') || fallback}</p>;
}

export function FilmDirector({ film, fallback = '' }: { film: Direction; fallback?: string }) {
  const director = film.director_text || film.credits.filter(c => c.role === 'director').map(c => c.name).join(', ') || fallback;
  return director ? <p className="detail-director">{director}</p> : null;
}

export function externalScores(film: ExternalRatings) {
  return [
    { label: 'IMDb', value: film.imdb_rating, unit: '/10' },
    { label: 'Metascore', value: film.metascore, unit: '/100' },
    { label: 'Rotten Tomatoes', value: film.rt_score, unit: '%' },
  ].filter(score => score.value !== null);
}

export function ExternalScores({ scores, label }: { scores: ReturnType<typeof externalScores>; label?: string }) {
  return scores.length > 0 && <div className="external-scores" aria-label={label}>{scores.map(({ label, value, unit }) =>
    <div key={label}><span>{label}</span><b>{number(value)}<small>{unit}</small></b></div>)}</div>;
}
