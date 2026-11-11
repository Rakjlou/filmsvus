import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { PARIS } from '../import/parse.ts';
import { normalizeImdb } from '../repo/films.ts';
import { UpstreamError } from './network.ts';
import type { Fetch, Throttle } from './network.ts';

export interface OmdbData {
  Response: string; Error?: string; Search?: OmdbData[]; totalResults?: string;
  Title?: string; Year?: string; imdbID?: string; Runtime?: string; Genre?: string;
  Country?: string; Language?: string; Rated?: string; imdbRating?: string;
  imdbVotes?: string; Metascore?: string; Ratings?: { Source: string; Value: string }[];
  Awards?: string; BoxOffice?: string; Poster?: string; Plot?: string;
  Director?: string; Writer?: string; Actors?: string;
}
export class BudgetExceeded extends Error {
  statusCode = 429;
  constructor() { super('Budget OMDb quotidien atteint'); this.name = 'BudgetExceeded'; }
}
export class ConfigurationError extends Error { statusCode = 503; }

export function localDay(at: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

interface OmdbOptions {
  apiKey?: string; dailyBudget?: number; fetch?: Fetch; now?: () => Date; throttle?: Throttle;
}

export class OmdbClient {
  db: DatabaseSync; fetch: Fetch; apiKey: string; dailyBudget: number;
  now: () => Date; throttle: Throttle;
  inflight = new Map<string, Promise<OmdbData>>();
  constructor(db: DatabaseSync, options: OmdbOptions = {}) {
    this.db = db;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.apiKey = options.apiKey ?? process.env.OMDB_API_KEY ?? '';
    this.dailyBudget = options.dailyBudget ?? Number(process.env.OMDB_DAILY_BUDGET ?? 900);
    if (!Number.isInteger(this.dailyBudget) || this.dailyBudget < 0) throw new Error('OMDB_DAILY_BUDGET doit être un entier positif ou nul');
    this.now = options.now ?? (() => new Date());
    this.throttle = options.throttle ?? (() => Promise.resolve());
  }
  budget() {
    const now = this.now(), day = localDay(now);
    // at is UTC; Intl handles Paris DST boundaries regardless of the OS timezone.
    const used = this.db.prepare("SELECT at FROM api_log WHERE provider='omdb' AND at>=?")
      .all(new Date(now.getTime() - 48 * 3_600_000).toISOString())
      .filter(row => localDay(new Date(String(row.at))) === day).length;
    return { day, timezone: PARIS, used, limit: this.dailyBudget, remaining: Math.max(0, this.dailyBudget - used) };
  }
  async request(params: Record<string, string>): Promise<OmdbData> {
    const key = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
    const cached = this.db.prepare("SELECT raw_response FROM api_log WHERE provider='omdb' AND request_key=? AND raw_response IS NOT NULL ORDER BY id DESC LIMIT 1").get(key);
    if (cached) return JSON.parse(String(cached.raw_response)) as OmdbData;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const work = this.perform(key);
    this.inflight.set(key, work);
    try { return await work; } finally { this.inflight.delete(key); }
  }
  private async perform(key: string): Promise<OmdbData> {
    if (!this.apiKey) throw new ConfigurationError('Configurer OMDB_API_KEY dans .env');
    await this.throttle();
    // Reserve synchronously before yielding to fetch, including across processes.
    const logId = transaction(this.db, () => {
      if (this.budget().remaining === 0) throw new BudgetExceeded();
      return this.db.prepare("INSERT INTO api_log(provider,request_key,status,at) VALUES ('omdb',?,0,?)")
        .run(key, this.now().toISOString()).lastInsertRowid;
    });
    let status = 0;
    try {
      const url = new URL('https://www.omdbapi.com/');
      url.search = key;
      url.searchParams.set('apikey', this.apiKey);
      const response = await this.fetch(url, { signal: AbortSignal.timeout(20_000) });
      status = response.status;
      if (!response.ok) throw new UpstreamError(`OMDb HTTP ${status}`);
      const raw: unknown = await response.json();
      if (!raw || typeof raw !== 'object' || !('Response' in raw) || !['True', 'False'].includes(String(raw.Response))) {
        throw new UpstreamError('Réponse OMDb invalide');
      }
      const data = raw as OmdbData;
      if (data.Response === 'False' && /request limit|too many|quota/i.test(data.Error ?? '')) throw new BudgetExceeded();
      if (data.Response === 'False' && /api key|unauthorized/i.test(data.Error ?? '')) throw new ConfigurationError('Clé OMDb refusée');
      this.db.prepare('UPDATE api_log SET status=?,raw_response=? WHERE id=?').run(status, JSON.stringify(data), logId);
      return data;
    } catch (error) {
      this.db.prepare('UPDATE api_log SET status=? WHERE id=?').run(status, logId);
      if (error instanceof BudgetExceeded || error instanceof ConfigurationError || error instanceof UpstreamError) throw error;
      // Do not expose fetch errors: their message can contain the secret query key.
      throw new UpstreamError('Appel OMDb impossible');
    }
  }
  search(query: string): Promise<OmdbData> { return this.request({ s: query.trim(), type: 'movie' }); }
  byId(id: string): Promise<OmdbData> {
    id = normalizeImdb(id);
    // A successful t= lookup already contains full details for this IMDb ID.
    const cached = this.db.prepare(`SELECT raw_response FROM api_log WHERE provider='omdb'
      AND raw_response IS NOT NULL AND json_extract(raw_response,'$.imdbID')=?
      AND json_extract(raw_response,'$.Response')='True' AND request_key LIKE '%plot=full%'
      ORDER BY id DESC LIMIT 1`).get(id);
    return cached ? Promise.resolve(JSON.parse(String(cached.raw_response)) as OmdbData)
      : this.request({ i: id, plot: 'full' });
  }
  byTitle(title: string, year?: number): Promise<OmdbData> {
    return this.request({ t: title.trim(), plot: 'full', type: 'movie', ...(year === undefined ? {} : { y: String(year) }) });
  }
}
