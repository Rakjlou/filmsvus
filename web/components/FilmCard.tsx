import { Link } from 'react-router';
import type { Film } from '../types.ts';
import { date, number, scoreTone } from '../format.ts';
import { personScore } from '../listState.ts';
import { Poster } from './Poster.tsx';
import { displayTitles } from '../titles.ts';

export function Score({ value, small = false }: { value: number | null; small?: boolean }) {
  return <span role="img" className={`score ${scoreTone(value)} ${small ? 'score-small' : ''}`} aria-label={value === null ? 'Pas noté' : `${number(value)} sur 10`}>{number(value)}{!small && value !== null && <small>/10</small>}</span>;
}
export function FilmCard({ film, returnTo }: { film: Film; returnTo: string }) {
  return <article className="film-card"><Link className="card-link" to={`/film/${film.id}`} state={{ returnTo }}>
    <div className="card-art"><Poster title={displayTitles(film).main} src={film.poster_url} />{film.tags.length > 0 && <span className="poster-tags" aria-label={film.tags.map(t => `${t.emoji ?? ''} ${t.label}`).join(', ')}>{film.tags.map(t => <span key={t.id} title={t.label}>{t.emoji || t.label}</span>)}</span>}</div>
    <div className="card-meta">{film.year !== null && <span>{film.year}</span>}<Score value={film.avg} /></div>
    <h2>{displayTitles(film).main}</h2><p className="card-director">{film.director_text || film.credits.find(c => c.role === 'director')?.name || 'Réalisation à découvrir'}</p>
    <div className="card-bottom"><span>Fleur <b>{number(personScore(film, 'Fleur'))}</b><span className="rating-separator">·</span>Noé <b>{number(personScore(film, 'Noé'))}</b></span><span className="card-watch-date">{date(film.watched_at)}</span></div>
  </Link></article>;
}
export function FilmRow({ film, returnTo, sortByGap = false }: { film: Film; returnTo: string; sortByGap?: boolean }) {
  const director = film.director_text || film.credits.find(c => c.role === 'director')?.name;
  const fleur = personScore(film, 'Fleur'), noe = personScore(film, 'Noé');
  const showGap = sortByGap || (film.gap !== null && film.gap >= 3);
  return <li className="film-row"><Link to={`/film/${film.id}`} state={{ returnTo }}>
    <time className="row-desktop" dateTime={film.watched_at}>{date(film.watched_at)}</time>
    <div className="row-title"><Poster title={displayTitles(film).main} src={film.poster_url} /><div className="row-copy"><h2>{displayTitles(film).main}</h2><p className="row-mobile">{director && <>{director} · </>}<time dateTime={film.watched_at}>{date(film.watched_at)}</time></p></div></div>
    <span className="row-director row-desktop">{director}</span>
    <span className="row-desktop row-number" aria-label={`Fleur : ${number(fleur)}`}>{number(fleur)}</span>
    <span className="row-desktop row-number" aria-label={`Noé : ${number(noe)}`}>{number(noe)}</span>
    <div className="row-average"><Score small value={film.avg} /><small className="row-mobile">F {number(fleur)} · N {number(noe)}{showGap && <span className="row-gap"> · Δ {number(film.gap)}</span>}</small></div>
    <span className="row-desktop row-number row-gap" aria-label={showGap ? `Écart : ${number(film.gap)}` : undefined}>{showGap ? number(film.gap) : ''}</span>
    <span className="row-desktop row-number" aria-label={`IMDb : ${number(film.imdb_rating)}`}>{number(film.imdb_rating)}</span>
  </Link></li>;
}
