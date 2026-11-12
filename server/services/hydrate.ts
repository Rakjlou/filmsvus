import { mkdir, rename, unlink, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transaction } from '../db/index.ts';
import { FilmsRepo, normalizeImdb } from '../repo/films.ts';
import type { Credit, Film, FilmFields, Role } from '../repo/films.ts';
import { localDay, OmdbClient } from './omdb.ts';
import type { OmdbData } from './omdb.ts';
import { WikidataClient, parseWikidata } from './wikidata.ts';
import type { WikidataCandidate } from './wikidata.ts';
import { UpstreamError } from './network.ts';
import type { Fetch } from './network.ts';
import { normalizeTitle } from '../../shared/titles.ts';
export { normalizeTitle } from '../../shared/titles.ts';

const text = (value?: string): string | null => value && value !== 'N/A' ? value : null;
const number = (value?: string): number | null => {
  const parsed = Number.parseFloat((value ?? '').replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const list = (value?: string): string[] => text(value)?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
export function omdbFields(data: OmdbData): Partial<FilmFields> {
  return {
    year: number(data.Year), runtime_min: number(data.Runtime),
    genres: list(data.Genre), countries: list(data.Country), languages: list(data.Language),
    rated: text(data.Rated), imdb_rating: number(data.imdbRating), imdb_votes: number(data.imdbVotes),
    metascore: number(data.Metascore), rt_score: number(data.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value),
    awards: text(data.Awards), box_office: text(data.BoxOffice), plot_en: text(data.Plot), omdb_raw: JSON.stringify(data),
  };
}
export function omdbCredits(data: OmdbData): Credit[] {
  return ([['director', data.Director], ['writer', data.Writer], ['actor', data.Actors]] as [Role, string | undefined][])
    .flatMap(([role, names]) => list(names).map((name, position) => ({ role, name, position, source: 'omdb' as const })));
}
export function guessYear(film: Pick<Film, 'title' | 'year'>): number | undefined {
  return film.year ?? (Number(/\((\d{4})\)\s*$/.exec(film.title)?.[1]) || undefined);
}
const searchTitle = (title: string) => title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
function directorMatch(expected: string, directors: string[]): boolean {
  const names = expected.replace(/\([^)]*\)/g, '').split(/[,;/&]|\bet\b|\band\b/i).map(name => name.trim()).filter(Boolean);
  return names.some(name => directors.some(director => {
    if (normalizeTitle(name) === normalizeTitle(director)) return true;
    const surname = director.trim().split(/\s+/).at(-1)!;
    // A surname alone, or among annotated/co-director text, is a strong clue.
    return normalizeTitle(name.split(/\s+/).at(-1)!) === normalizeTitle(surname);
  }));
}
export function selectWikidataCandidate(film: Pick<Film, 'title' | 'year' | 'director_text' | 'watched_at'>, candidates: WikidataCandidate[]) {
  const title = normalizeTitle(searchTitle(film.title)), year = guessYear(film);
  const watchedYear = Number(localDay(new Date(film.watched_at)).slice(0, 4));
  const ranked = candidates.filter(candidate => (candidate.year === null || candidate.year <= watchedYear) &&
    (year === undefined || candidate.year === year)).map(candidate => {
    const titleMatch = [candidate.titleFr, candidate.titleEn, candidate.originalTitle].some(t => t && normalizeTitle(t) === title);
    const director = Boolean(film.director_text?.trim() && directorMatch(film.director_text, candidate.directors));
    return { candidate, titleMatch, directorMatch: director, score: (titleMatch ? 100 : 0) + (director ? 80 : 0) + (year !== undefined ? 20 : 0) };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const titleMatches = ranked.filter(c => c.titleMatch);
  const unambiguous = best?.titleMatch && (best.directorMatch
    ? !ranked.slice(1).some(c => c.score === best.score)
    : titleMatches.length === 1 && best.candidate.year !== null &&
      // Do not silently ignore a known conflicting director.
      (!film.director_text?.trim() || best.candidate.directors.length === 0));
  return { best: unambiguous ? best.candidate : null, ranked };
}
interface Options { fetch?: Fetch; postersDir?: string; now?: () => Date }
export class HydrationConflict extends Error { statusCode = 409; }

export class Hydrator {
  repo: FilmsRepo; omdb: OmdbClient; wikidata: WikidataClient;
  fetch: Fetch; postersDir: string; now: () => Date;
  inflight = new Map<number, Promise<Film>>();
  constructor(repo: FilmsRepo, omdb: OmdbClient, wikidata: WikidataClient, options: Options = {}) {
    this.repo = repo; this.omdb = omdb; this.wikidata = wikidata;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.postersDir = options.postersDir ?? 'data/posters';
    this.now = options.now ?? (() => new Date());
  }
  async hydrateFilm(id: number, options: { force?: boolean } = {}): Promise<Film> {
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const work = this.perform(id, options.force ?? false);
    this.inflight.set(id, work);
    try { return await work; } finally { this.inflight.delete(id); }
  }
  private async perform(id: number, force: boolean): Promise<Film> {
    const film = this.repo.get(id);
    if (film.hydrated && !force) return film;
    const requireIdentity = (imdbId: string | null) => {
      const current = this.repo.get(id);
      if (current.imdb_id !== imdbId || current.title !== film.title) {
        throw new HydrationConflict('Film modifié pendant l’hydratation ; relancer avec les nouvelles informations');
      }
      return current;
    };
    const markReview = (candidates: WikidataCandidate[] = []) => {
      transaction(this.repo.db, () => {
        requireIdentity(film.imdb_id);
        this.repo.writeFields(id, { needs_review: true,
          ...(candidates.length ? { wikidata_raw: JSON.stringify({ searchCandidates: candidates.slice(0, 5) }) } : {}) });
      });
      return this.repo.get(id);
    };
    let data: OmdbData, selected: WikidataCandidate | null = null;
    if (film.imdb_id) data = await this.omdb.byId(film.imdb_id);
    else {
      const year = guessYear(film);
      const candidates = await this.wikidata.searchFilms(searchTitle(film.title));
      if (candidates.length) {
        const choice = selectWikidataCandidate(film, candidates);
        if (!choice.best) return markReview(choice.ranked.length ? choice.ranked.map(c => c.candidate) : candidates);
        selected = choice.best;
        data = await this.omdb.byId(selected.imdbID);
      } else {
        data = await this.omdb.byTitle(searchTitle(film.title), year);
        const candidateYear = number(data.Year);
        if (data.Response !== 'True' || !data.imdbID ||
          (year !== undefined && candidateYear !== year) ||
          (candidateYear !== null && candidateYear > Number(localDay(new Date(film.watched_at)).slice(0, 4)))) {
          return markReview();
        }
      }
    }
    if (data.Response !== 'True' || !data.imdbID) return markReview(selected ? [selected] : []);
    const imdbId = normalizeImdb(data.imdbID);
    if ((film.imdb_id || selected) && imdbId !== (film.imdb_id ?? selected!.imdbID)) throw new UpstreamError('OMDb a renvoyé un autre ID IMDb');
    // Keep OMDb progress if Wikidata/poster fails; retry reuses the cached response.
    transaction(this.repo.db, () => {
      requireIdentity(film.imdb_id);
      this.repo.writeFields(id, { ...omdbFields(data), imdb_id: imdbId, needs_review: false });
      if (selected) this.repo.writeFields(id, { title_fr: selected.titleFr,
        wikidata_raw: JSON.stringify({ candidate: selected }) });
      this.repo.writeCredits(id, omdbCredits(data));
    });
    const wikidataRaw = await this.wikidata.byImdb(imdbId);
    const extra = parseWikidata(wikidataRaw);
    let plotFr: string | null = null;
    if (extra.frwiki_title) {
      try { plotFr = await this.wikidata.frenchSynopsis(extra.frwiki_title); }
      catch { console.warn(`Film ${id} : synopsis Wikipédia indisponible, enrichissement poursuivi.`); }
    }
    const posterPath = text(data.Poster) ? await this.downloadPoster(imdbId, data.Poster!) : null;
    transaction(this.repo.db, () => {
      const current = requireIdentity(imdbId);
      const wikiTitle = selected?.originalTitle ?? extra.original_title;
      const previousOmdbTitle = film.omdb_raw ? text((JSON.parse(film.omdb_raw) as OmdbData).Title) : null;
      // No provenance column: a value matching the previous/current OMDb Title is
      // treated as automatic. Distinct manually entered originals are preserved.
      const automaticTitle = !current.original_title || current.original_title === previousOmdbTitle || current.original_title === text(data.Title);
      const originalTitle = automaticTitle
        ? wikiTitle ?? (selected || wikidataRaw.results.bindings.length ? null : text(data.Title))
        : current.original_title;
      this.repo.writeFields(id, { title_fr: selected?.titleFr ?? extra.title_fr ?? current.title_fr,
        original_title: originalTitle, plot_fr: plotFr,
        wikidata_raw: JSON.stringify(wikidataRaw),
        poster_path: posterPath, hydrated_at: this.now().toISOString(), needs_review: false });
      this.repo.writeCredits(id, extra.credits);
      this.repo.writeCompanies(id, extra.companies);
    });
    return this.repo.get(id);
  }
  private async downloadPoster(imdbId: string, poster: string): Promise<string> {
    const filename = `${normalizeImdb(imdbId)}.jpg`;
    await mkdir(this.postersDir, { recursive: true });
    const path = join(this.postersDir, filename);
    try { await access(path); return filename; } catch { /* Download missing poster. */ }
    const url = new URL(poster);
    if (!['https:', 'http:'].includes(url.protocol)) throw new UpstreamError('URL affiche invalide');
    const response = await this.fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new UpstreamError(`Affiche HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) throw new UpstreamError('Affiche non image');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, bytes); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
    return filename;
  }
}
