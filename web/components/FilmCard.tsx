import { Link } from 'react-router';
import type { Film } from '../types.ts';
import { date, number, scoreTone } from '../format.ts';
import { personScore } from '../listState.ts';
import { Poster } from './Poster.tsx';

export function Score({ value, small = false }: { value: number | null; small?: boolean }) {
  return <span role="img" className={`score ${scoreTone(value)} ${small ? 'score-small' : ''}`} aria-label={value === null ? 'Pas noté' : `${number(value)} sur 10`}>{number(value)}{!small && value !== null && <small>/10</small>}</span>;
}
export function FilmCard({ film, returnTo }: { film: Film; returnTo: string }) {
  return <article className="film-card"><Link className="card-link" to={`/film/${film.id}`} state={{ returnTo }}>
    <div className="card-art"><Poster title={film.title} src={film.poster_url} />{film.tags.length > 0 && <span className="poster-tags" aria-label={film.tags.map(t => `${t.emoji ?? ''} ${t.label}`).join(', ')}>{film.tags.map(t => <span key={t.id} title={t.label}>{t.emoji || t.label}</span>)}</span>}</div>
    <div className="card-meta"><span>{film.year ?? 'Année à découvrir'}</span><Score value={film.avg} /></div>
    <h2>{film.title}</h2><p className="card-director">{film.director_text || film.credits.find(c => c.role === 'director')?.name || 'Réalisation à découvrir'}</p>
    <div className="card-bottom"><span>Fleur <b>{number(personScore(film, 'Fleur'))}</b><span className="rating-separator">·</span>Noé <b>{number(personScore(film, 'Noé'))}</b></span><span className="card-watch-date">{date(film.watched_at)}</span></div>
  </Link></article>;
}
export function FilmRow({ film, returnTo }: { film: Film; returnTo: string }) {
  return <li className="film-row"><Link to={`/film/${film.id}`} state={{ returnTo }}>
    <time dateTime={film.watched_at}>{date(film.watched_at)}</time><div className="row-title"><h2>{film.title}</h2><p>{film.director_text || 'Réalisation à découvrir'}</p></div>
    <div className="row-ratings"><span><small>Fleur</small>{number(personScore(film, 'Fleur'))}</span><span><small>Noé</small>{number(personScore(film, 'Noé'))}</span><span><small>Moy.</small><Score small value={film.avg} /></span><span><small>Écart</small>{number(film.gap)}</span></div>
  </Link></li>;
}
