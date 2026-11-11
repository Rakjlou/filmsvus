import type { Film, Viewer } from './films.ts';
import { PARIS } from '../import/parse.ts';

const mean = (values: number[]): number | null => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function correlation(pairs: [number, number][]): number | null {
  if (pairs.length < 2) return null;
  const x = mean(pairs.map(p => p[0]))!, y = mean(pairs.map(p => p[1]))!;
  let xy = 0, xx = 0, yy = 0;
  for (const [a, b] of pairs) { xy += (a - x) * (b - y); xx += (a - x) ** 2; yy += (b - y) ** 2; }
  return xx && yy ? xy / Math.sqrt(xx * yy) : null;
}

export function computeStats(films: Film[], viewers: Viewer[]) {
  const years: Record<string, number> = {}, months: Record<string, number> = {};
  const groups = { directors: new Map<string, Film[]>(), genres: new Map<string, Film[]>(), decades: new Map<string, Film[]>() };
  const histogram: Record<string, number> = {};
  const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: PARIS, year: 'numeric', month: '2-digit' });
  const group = (map: Map<string, Film[]>, key: string, film: Film) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(film);
  };
  const rated = films.filter(f => f.avg !== null);
  for (const film of films) {
    const parts = Object.fromEntries(calendar.formatToParts(new Date(film.watched_at)).map(p => [p.type, p.value]));
    const year = parts.year!, month = `${year}-${parts.month}`;
    years[year] = (years[year] ?? 0) + 1;
    months[month] = (months[month] ?? 0) + 1;
    if (film.avg !== null) {
      const bin = String(Math.floor(film.avg));
      histogram[bin] = (histogram[bin] ?? 0) + 1;
    }
    const directors = film.credits.filter(c => c.role === 'director').map(c => c.name);
    for (const name of new Set(directors.length ? directors : film.director_text ? [film.director_text] : [])) group(groups.directors, name, film);
    if (film.hydrated) {
      for (const genre of new Set(film.genres)) group(groups.genres, genre, film);
      if (film.year !== null) group(groups.decades, String(Math.floor(film.year / 10) * 10), film);
    }
  }
  const rank = (film: Film) => ({ id: film.id, title: film.title, avg: film.avg, gap: film.gap });
  const aggregates = (map: Map<string, Film[]>) => [...map].map(([name, fs]) => ({ name, count: fs.length,
    avg: mean(fs.flatMap(f => f.avg === null ? [] : [f.avg])) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
  const hydrated = films.filter(f => f.hydrated).length;
  return {
    total: films.length, rated: rated.length,
    films_by_year: years, films_by_month: months,
    avg: mean(rated.map(f => f.avg!)),
    viewers: viewers.map(v => {
      const scores = films.flatMap(f => f.ratings.filter(r => r.id === v.id && r.score !== null).map(r => r.score!));
      const distribution: Record<string, number> = {};
      for (const score of scores) {
        const bin = String(Math.floor(score));
        distribution[bin] = (distribution[bin] ?? 0) + 1;
      }
      return { ...v, count: scores.length, avg: mean(scores), rating_distribution: distribution };
    }),
    rating_distribution: histogram,
    disagreements: films.filter(f => f.gap !== null).sort((a, b) => b.gap! - a.gap!).slice(0, 10).map(rank),
    top: [...rated].sort((a, b) => b.avg! - a.avg!).slice(0, 10).map(rank),
    flop: [...rated].sort((a, b) => a.avg! - b.avg!).slice(0, 10).map(rank),
    directors: aggregates(groups.directors), genres: aggregates(groups.genres), decades: aggregates(groups.decades),
    imdb_correlation: correlation(films.flatMap(f => f.avg !== null && f.imdb_rating !== null ? [[f.avg, f.imdb_rating] as [number, number]] : [])),
    imdb_pairs: films.flatMap(f => f.avg !== null && f.imdb_rating !== null
      ? [{ id: f.id, title: f.title, avg: f.avg, imdb_rating: f.imdb_rating }] : []),
    hydrated, hydration_rate: films.length ? hydrated / films.length : 0,
  };
}
