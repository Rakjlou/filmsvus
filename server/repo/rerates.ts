import { transaction } from '../db/index.ts';
import { Conflict, FilmsRepo, InvalidInput, NotFound, parseJsonColumn, posterUrl } from './films.ts';
import type { Film, Rerate } from './films.ts';

export type BlindFilm = Pick<Film, 'id' | 'title' | 'title_fr' | 'original_title' | 'year' | 'watched_at'
  | 'director_text' | 'credits' | 'runtime_min' | 'genres' | 'countries' | 'poster_url'
  | 'plot_fr' | 'plot_en' | 'imdb_rating' | 'metascore' | 'rt_score'>;
export interface RerateNext { remaining: number; film: BlindFilm | null }

// Clamp leap day to February's last day, preserving the UTC time of day.
export function rerateCutoff(now: number): string {
  const date = new Date(now), month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - 2);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString();
}

const eligible = `julianday(f.watched_at)<=julianday(?)
  AND NOT EXISTS (SELECT 1 FROM rerates r WHERE r.film_id=f.id)`;

export class ReratesRepo {
  films: FilmsRepo;
  now: () => number;
  constructor(films: FilmsRepo, now: () => number) { this.films = films; this.now = now; }

  next(exclude: number[] = []): RerateNext {
    const db = this.films.db, cutoff = rerateCutoff(this.now());
    const remaining = Number(db.prepare(`SELECT count(*) AS n FROM films f WHERE ${eligible}`).get(cutoff)!.n);
    const exclusion = exclude.length ? ` AND f.id NOT IN (${exclude.map(() => '?').join(',')})` : '';
    // Explicit allowlist: personal notes and raw provider responses never enter the blind payload.
    const row = db.prepare(`SELECT f.id,f.title,f.title_fr,f.original_title,f.year,f.watched_at,
      f.director_text,f.runtime_min,f.genres,f.countries,f.poster_path,
      f.plot_fr,f.plot_en,f.imdb_rating,f.metascore,f.rt_score
      FROM films f WHERE ${eligible}${exclusion} ORDER BY random() LIMIT 1`).get(cutoff, ...exclude);
    if (!row) return { remaining, film: null };
    const { genres, countries, poster_path, ...fields } = row;
    return { remaining, film: { ...fields, genres: parseJsonColumn(genres), countries: parseJsonColumn(countries),
      poster_url: posterUrl(poster_path), credits: this.films.credits(Number(row.id)) } as unknown as BlindFilm };
  }

  private claim(id: number, status: 'rated' | 'ignored'): void {
    const at = this.now();
    if (!this.films.db.prepare(`SELECT id FROM films f WHERE f.id=? AND ${eligible}`).get(id, rerateCutoff(at))) {
      this.films.require(id);
      throw new Conflict('Ce film est trop récent ou a déjà été renoté ou ignoré. Passez au film suivant.');
    }
    this.films.db.prepare('INSERT INTO rerates VALUES (?,?,?)').run(id, status, new Date(at).toISOString());
  }

  rate(id: number, scores: Record<string, number>): Rerate {
    return transaction(this.films.db, () => {
      this.claim(id, 'rated');
      const viewers = this.films.viewers(), keys = Object.keys(scores);
      if (keys.length !== viewers.length || !viewers.every(v => Object.hasOwn(scores, String(v.id)))) {
        const names = new Intl.ListFormat('fr-FR').format(viewers.map(v => v.name));
        throw new InvalidInput(`Renseignez une note entière de 0 à 10 pour ${names} uniquement.`);
      }
      const insert = this.films.db.prepare('INSERT INTO rerate_scores VALUES (?,?,?)');
      for (const viewer of viewers) insert.run(id, viewer.id, scores[String(viewer.id)]!);
      return this.films.rerate(id)!;
    });
  }

  ignore(id: number): void {
    transaction(this.films.db, () => this.claim(id, 'ignored'));
  }

  delete(id: number): void {
    if (!this.films.db.prepare('DELETE FROM rerates WHERE film_id=?').run(id).changes) {
      throw new NotFound('Aucune renote pour ce film.');
    }
  }
}
