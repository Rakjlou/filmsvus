import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { ratingMetrics } from '../import/parse.ts';

export type Role = 'director' | 'writer' | 'composer' | 'cinematographer' | 'editor' | 'producer' | 'actor';
export type Source = 'omdb' | 'wikidata' | 'manual';
export interface Viewer { id: number; name: string; is_core: boolean }
export interface Rating extends Viewer { score: number | null }
export interface Tag { id: number; label: string; emoji: string | null; color: string | null }
export interface Credit { role: Role; name: string; position: number; source: Source }
export interface Company { name: string; source: Source }
export interface FilmFields {
  title: string; title_fr: string | null; original_title: string | null;
  year: number | null; watched_at: string; director_text: string | null;
  summary: string | null; comment: string | null; imdb_id: string | null;
  runtime_min: number | null;
  genres: string[]; countries: string[]; languages: string[]; rated: string | null;
  imdb_rating: number | null; imdb_votes: number | null; metascore: number | null;
  rt_score: number | null; awards: string | null; box_office: string | null;
  poster_path: string | null; plot_en: string | null; plot_fr: string | null; omdb_raw: string | null;
  wikidata_raw: string | null; hydrated_at: string | null; needs_review: boolean;
}
export interface Film extends FilmFields {
  id: number; created_at: string; updated_at: string;
  ratings: Rating[]; core_ratings: Rating[];
  avg: number | null; gap: number | null;
  tags: Tag[]; credits: Credit[]; companies: Company[];
  poster_url: string | null; hydrated: boolean;
}
export interface RatingInput { viewer_id: number; score: number | null }
export type FilmInput = Partial<FilmFields> & {
  ratings?: RatingInput[]; tag_ids?: number[]; credits?: Credit[]; companies?: Company[];
};
type Row = Record<string, unknown>;

export class NotFound extends Error { statusCode = 404; }
export class InvalidInput extends Error { statusCode = 400; }

// Only these trusted identifiers can appear in a dynamically constructed UPDATE.
const columns = new Set([
  'title', 'title_fr', 'original_title', 'year', 'watched_at', 'director_text', 'summary',
  'comment', 'imdb_id', 'runtime_min', 'genres', 'countries', 'languages',
  'rated', 'imdb_rating', 'imdb_votes', 'metascore', 'rt_score', 'awards', 'box_office',
  'poster_path', 'plot_en', 'plot_fr', 'omdb_raw', 'wikidata_raw', 'hydrated_at', 'needs_review',
]);
const jsonColumns = new Set(['genres', 'countries', 'languages']);

export function normalizeImdb(value: string): string {
  if (/^tt\d{7,10}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const match = /^\/title\/(tt\d{7,10})(?:\/|$)/.exec(url.pathname);
    if (['http:', 'https:'].includes(url.protocol) && /^(www\.)?imdb\.com$/.test(url.hostname) && match) return match[1]!;
  } catch { /* Invalid IDs are rejected below. */ }
  throw new InvalidInput('ID ou URL IMDb invalide');
}

export class FilmsRepo {
  db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  viewers(): Viewer[] {
    return (this.db.prepare('SELECT * FROM viewers WHERE is_core=1 ORDER BY id').all() as unknown as Viewer[])
      .map(v => ({ ...v, is_core: Boolean(v.is_core) }));
  }
  tags(): Tag[] { return this.db.prepare('SELECT * FROM tags ORDER BY id').all() as unknown as Tag[]; }
  createTag(input: Omit<Tag, 'id'>): Tag {
    const result = this.db.prepare('INSERT INTO tags(label,emoji,color) VALUES (?,?,?)')
      .run(input.label, input.emoji, input.color);
    return this.db.prepare('SELECT * FROM tags WHERE id=?').get(result.lastInsertRowid) as unknown as Tag;
  }
  require(id: number): void {
    if (!this.db.prepare('SELECT id FROM films WHERE id=?').get(id)) throw new NotFound('Film introuvable');
  }
  list(detail = false, id?: number): Film[] {
    const where = id === undefined ? '' : ' WHERE id=?';
    const rows = this.db.prepare(`SELECT * FROM films${where} ORDER BY watched_at DESC, id DESC`)
      .all(...(id === undefined ? [] : [id])) as Row[];
    // Four batched relations: no per-film queries, including in the complete list.
    const ratings = this.db.prepare(`SELECT r.*,v.name,v.is_core FROM ratings r
      JOIN viewers v ON v.id=r.viewer_id`).all() as Row[];
    const tags = this.db.prepare('SELECT ft.film_id,t.* FROM film_tags ft JOIN tags t ON t.id=ft.tag_id').all() as Row[];
    const credits = this.db.prepare('SELECT * FROM credits ORDER BY role,position,name').all() as Row[];
    const companies = this.db.prepare('SELECT * FROM companies ORDER BY name').all() as Row[];
    const group = (data: Row[]) => {
      const map = new Map<number, Row[]>();
      for (const row of data) {
        const key = Number(row.film_id);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(row);
      }
      return map;
    };
    const byRating = group(ratings), byTag = group(tags), byCredit = group(credits), byCompany = group(companies);
    const viewers = this.viewers();
    return rows.map(row => {
      const filmId = Number(row.id);
      const filmRatings = viewers.map(v => ({ ...v,
        score: (byRating.get(filmId)?.find(r => Number(r.viewer_id) === v.id)?.score ?? null) as number | null,
      }));
      const core = filmRatings.filter(v => v.is_core);
      const film = { ...row,
        genres: JSON.parse(String(row.genres)), countries: JSON.parse(String(row.countries)),
        languages: JSON.parse(String(row.languages)),
        needs_review: Boolean(row.needs_review),
        ratings: filmRatings, core_ratings: core,
        ...ratingMetrics(core.map(v => v.score)),
        tags: (byTag.get(filmId) ?? []).map(({ film_id, ...tag }) => tag),
        credits: (byCredit.get(filmId) ?? []).map(({ film_id, ...credit }) => credit),
        companies: (byCompany.get(filmId) ?? []).map(({ film_id, ...company }) => company),
        poster_url: row.poster_path ? `/posters/${row.poster_path}` : null,
        hydrated: Boolean(row.hydrated_at),
      } as unknown as Film;
      if (!detail) {
        // Raw provider responses are useful on the detail endpoint only.
        delete (film as Partial<Film>).omdb_raw;
        delete (film as Partial<Film>).wikidata_raw;
      }
      return film;
    });
  }
  get(id: number): Film {
    const film = this.list(true, id)[0];
    if (!film) throw new NotFound('Film introuvable');
    return film;
  }
  writeFields(id: number, fields: FilmInput): void {
    const entries = Object.entries(fields).filter(([key, value]) => columns.has(key) && value !== undefined);
    if (!entries.length) return;
    const values = entries.map(([key, value]): SQLInputValue => {
      if (key === 'imdb_id' && value !== null) return normalizeImdb(String(value));
      if (key === 'watched_at') return new Date(String(value)).toISOString();
      if (key === 'title') return String(value).trim();
      if (jsonColumns.has(key)) return JSON.stringify(value);
      return typeof value === 'boolean' ? Number(value) : value as SQLInputValue;
    });
    this.db.prepare(`UPDATE films SET ${entries.map(([key]) => `${key}=?`).join(',')},
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(...values, id);
  }
  create(input: FilmInput & { title: string }): Film {
    const id = transaction(this.db, () => {
      const result = this.db.prepare('INSERT INTO films(title,watched_at) VALUES (?,?)')
        .run(input.title, input.watched_at ?? new Date().toISOString());
      const id = Number(result.lastInsertRowid);
      this.writeFields(id, input);
      if (input.ratings) this.writeRatings(id, input.ratings);
      if (input.tag_ids) this.writeTags(id, input.tag_ids);
      if (input.credits) this.writeCredits(id, input.credits);
      if (input.companies) this.writeCompanies(id, input.companies);
      return id;
    });
    return this.get(id);
  }
  patch(id: number, input: FilmInput): Film {
    transaction(this.db, () => {
      const previous = this.get(id);
      if (input.imdb_id !== undefined && (input.imdb_id ? normalizeImdb(input.imdb_id) : null) !== previous.imdb_id) {
        this.writeFields(id, { title_fr: null, original_title: null, year: null,
          runtime_min: null, genres: [], countries: [], languages: [], rated: null,
          imdb_rating: null, imdb_votes: null, metascore: null, rt_score: null,
          awards: null, box_office: null, plot_en: null, plot_fr: null, hydrated_at: null,
          poster_path: null, omdb_raw: null, wikidata_raw: null, needs_review: false });
        this.db.prepare("DELETE FROM credits WHERE film_id=? AND source!='manual'").run(id);
        this.db.prepare("DELETE FROM companies WHERE film_id=? AND source!='manual'").run(id);
      }
      this.writeFields(id, input);
      if (input.ratings) this.writeRatings(id, input.ratings);
      if (input.tag_ids) this.writeTags(id, input.tag_ids);
      if (input.credits) this.writeCredits(id, input.credits);
      if (input.companies) this.writeCompanies(id, input.companies);
      this.db.prepare("UPDATE films SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(id);
    });
    return this.get(id);
  }
  delete(id: number): void { this.require(id); this.db.prepare('DELETE FROM films WHERE id=?').run(id); }
  writeRatings(id: number, ratings: RatingInput[]): void {
    const upsert = this.db.prepare(`INSERT INTO ratings(film_id,viewer_id,score) VALUES (?,?,?)
      ON CONFLICT(film_id,viewer_id) DO UPDATE SET score=excluded.score`);
    for (const rating of ratings) upsert.run(id, rating.viewer_id, rating.score);
  }
  setRatings(id: number, ratings: RatingInput[]): Film { return this.patch(id, { ratings }); }
  writeTags(id: number, ids: number[]): void {
    this.db.prepare('DELETE FROM film_tags WHERE film_id=?').run(id);
    for (const tag of new Set(ids)) this.db.prepare('INSERT INTO film_tags VALUES (?,?)').run(id, tag);
  }
  setTags(id: number, ids: number[]): Film { return this.patch(id, { tag_ids: ids }); }
  writeCredits(id: number, credits: Credit[]): void {
    const insert = this.db.prepare(`INSERT INTO credits(film_id,role,name,position,source) VALUES (?,?,?,?,?)
      ON CONFLICT(film_id,role,name) DO UPDATE SET position=excluded.position,source=excluded.source
      WHERE excluded.source='manual'`);
    for (const c of credits) insert.run(id, c.role, c.name.trim(), c.position, c.source);
  }
  writeCompanies(id: number, companies: Company[]): void {
    const insert = this.db.prepare(`INSERT INTO companies(film_id,name,source) VALUES (?,?,?)
      ON CONFLICT(film_id,name) DO UPDATE SET source=excluded.source WHERE excluded.source='manual'`);
    for (const c of companies) insert.run(id, c.name.trim(), c.source);
  }
}
