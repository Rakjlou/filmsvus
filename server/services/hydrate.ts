import { mkdir, rename, unlink, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transaction } from '../db/index.ts';
import { FilmsRepo, normalizeImdb } from '../repo/films.ts';
import type { Credit, Film, FilmFields, Role } from '../repo/films.ts';
import { OmdbClient } from './omdb.ts';
import type { OmdbData } from './omdb.ts';
import { WikidataClient, parseWikidata } from './wikidata.ts';
import { UpstreamError } from './network.ts';
import type { Fetch } from './network.ts';

const text = (value?: string): string | null => value && value !== 'N/A' ? value : null;
const number = (value?: string): number | null => {
  const parsed = Number.parseFloat((value ?? '').replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const list = (value?: string): string[] => text(value)?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
export function omdbFields(data: OmdbData): Partial<FilmFields> {
  return {
    original_title: text(data.Title), year: number(data.Year), runtime_min: number(data.Runtime),
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
  async hydrateFilm(id: number): Promise<Film> {
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const work = this.perform(id);
    this.inflight.set(id, work);
    try { return await work; } finally { this.inflight.delete(id); }
  }
  private async perform(id: number): Promise<Film> {
    const film = this.repo.get(id);
    if (film.hydrated) return film;
    const requireIdentity = (imdbId: string | null) => {
      const current = this.repo.get(id);
      if (current.imdb_id !== imdbId || current.title !== film.title) {
        throw new HydrationConflict('Film modifié pendant l’hydratation ; relancer avec les nouvelles informations');
      }
    };
    const markReview = () => {
      transaction(this.repo.db, () => {
        requireIdentity(film.imdb_id);
        this.repo.writeFields(id, { needs_review: true });
      });
      return this.repo.get(id);
    };
    let data: OmdbData;
    if (film.imdb_id) data = await this.omdb.byId(film.imdb_id);
    else {
      const year = guessYear(film);
      data = await this.omdb.byTitle(film.title.replace(/\s*\(\d{4}\)\s*$/, ''), year);
      const candidateYear = number(data.Year);
      if (data.Response !== 'True' || !data.imdbID ||
        (year !== undefined && candidateYear !== year) ||
        (candidateYear !== null && candidateYear > new Date(film.watched_at).getUTCFullYear())) {
        return markReview();
      }
    }
    if (data.Response !== 'True' || !data.imdbID) return markReview();
    const imdbId = normalizeImdb(data.imdbID);
    if (film.imdb_id && imdbId !== film.imdb_id) throw new UpstreamError('OMDb a renvoyé un autre ID IMDb');
    // Keep OMDb progress if Wikidata/poster fails; retry reuses the cached response.
    transaction(this.repo.db, () => {
      requireIdentity(film.imdb_id);
      this.repo.writeFields(id, { ...omdbFields(data), imdb_id: imdbId, needs_review: false });
      this.repo.writeCredits(id, omdbCredits(data));
    });
    const wikidataRaw = await this.wikidata.byImdb(imdbId);
    const extra = parseWikidata(wikidataRaw);
    const posterPath = text(data.Poster) ? await this.downloadPoster(imdbId, data.Poster!) : null;
    transaction(this.repo.db, () => {
      requireIdentity(imdbId);
      this.repo.writeFields(id, { title_fr: extra.title_fr, wikidata_raw: JSON.stringify(wikidataRaw),
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
