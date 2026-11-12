import type { DatabaseSync } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';
import type { Credit, Company, Role } from '../repo/films.ts';
import { normalizeImdb } from '../repo/films.ts';
import { createThrottle, UpstreamError } from './network.ts';
import type { Fetch, Throttle } from './network.ts';
import { normalizeTitle } from '../../shared/titles.ts';

interface Binding { value: string }
export interface WikidataData {
  results: { bindings: { filmLabel?: Binding; originalTitle?: Binding; frWiki?: Binding; role?: Binding; name?: Binding }[] };
}
export interface WikidataCandidate {
  imdbID: string; qid: string; titleFr: string | null; titleEn: string | null;
  originalTitle: string | null; originalLanguage: string | null; year: number | null; directors: string[];
}
interface Entity {
  labels?: Record<string, { value: string }>;
  claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>;
}
interface EntityResponse { entities: Record<string, Entity> }
const cachedClaims = new Set(['P31', 'P345', 'P577', 'P1476', 'P57', 'P58', 'P86', 'P344', 'P1040', 'P162', 'P272']);
function trimEntities(raw: EntityResponse): EntityResponse {
  return { entities: Object.fromEntries(Object.entries(raw.entities).map(([id, entity]) => [id, {
    labels: Object.fromEntries(Object.entries(entity.labels ?? {}).filter(([language]) => language === 'fr' || language === 'en')
      .map(([language, label]) => [language, { value: label.value }])),
    claims: Object.fromEntries(Object.entries(entity.claims ?? {}).filter(([property]) => cachedClaims.has(property))
      .map(([property, claims]) => [property, claims.map(claim => ({ mainsnak: { datavalue: claim.mainsnak.datavalue } }))])),
  }])) };
}
export class WikidataUnavailable extends UpstreamError {
  override name = 'WikidataUnavailable';
  readonly retryable = true;
}
const values = (entity: Entity, property: string) => entity.claims?.[property]?.map(c => c.mainsnak.datavalue?.value) ?? [];
const entityIds = (entity: Entity, property: string): string[] => values(entity, property)
  .flatMap(value => value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? [value.id] : []);
const label = (entity: Entity | undefined) => entity?.labels?.fr?.value ?? entity?.labels?.en?.value;
interface Options { fetch?: Fetch; throttle?: Throttle; now?: () => Date; sleep?: (ms: number) => Promise<void> }
export class WikidataClient {
  db: DatabaseSync; fetch: Fetch; throttle: Throttle; now: () => Date;
  sleep: (ms: number) => Promise<void>;
  inflight = new Map<string, Promise<unknown>>();
  constructor(db: DatabaseSync, options: Options = {}) {
    this.db = db; this.fetch = options.fetch ?? globalThis.fetch;
    this.throttle = options.throttle ?? createThrottle(200);
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? setTimeout;
  }
  private async request<T>(key: string, url: URL, accept: string, valid: (raw: T) => boolean, cacheRaw?: (raw: T) => T, provider = 'wikidata'): Promise<T> {
    const cached = this.db.prepare('SELECT id,raw_response FROM api_log WHERE provider=? AND request_key=? AND raw_response IS NOT NULL ORDER BY id DESC LIMIT 1').get(provider, key);
    if (cached) {
      const raw = JSON.parse(String(cached.raw_response)) as T;
      if (!cacheRaw) return raw;
      const trimmed = cacheRaw(raw);
      // Also shrink older, untrimmed cache entries when they are reused.
      const serialized = JSON.stringify(trimmed);
      if (serialized !== cached.raw_response) this.db.prepare('UPDATE api_log SET raw_response=? WHERE id=?').run(serialized, cached.id!);
      return trimmed;
    }
    const inflightKey = `${provider}:${key}`;
    const pending = this.inflight.get(inflightKey);
    if (pending) return pending as Promise<T>;
    const work = this.perform(key, url, accept, valid, cacheRaw, provider);
    this.inflight.set(inflightKey, work);
    try { return await work; } finally { this.inflight.delete(inflightKey); }
  }
  private async perform<T>(key: string, url: URL, accept: string, valid: (raw: T) => boolean, cacheRaw?: (raw: T) => T, provider = 'wikidata'): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      const logId = this.db.prepare('INSERT INTO api_log(provider,request_key,status,at) VALUES (?,?,0,?)')
        .run(provider, key, this.now().toISOString()).lastInsertRowid;
      let status = 0;
      let retryAfter: string | null = null;
      try {
        const response = await this.fetch(url, {
          headers: { 'User-Agent': 'filmsvus-local/0.1', Accept: accept }, signal: AbortSignal.timeout(30_000),
        });
        status = response.status;
        retryAfter = response.headers.get('Retry-After');
        if (!response.ok) throw new WikidataUnavailable(`${provider === 'wikipedia' ? 'Wikipédia' : 'Wikidata'} HTTP ${status}`);
        const raw = await response.json() as T;
        if (!raw || !valid(raw)) throw new WikidataUnavailable('Réponse Wikidata invalide');
        this.db.prepare('UPDATE api_log SET status=?,raw_response=? WHERE id=?').run(status, JSON.stringify(cacheRaw ? cacheRaw(raw) : raw), logId);
        return raw;
      } catch (error) {
        this.db.prepare('UPDATE api_log SET status=? WHERE id=?').run(status, logId);
        if ((status === 429 || status === 503) && attempt < 3) {
          const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
          const delay = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 30) * 1000 : 2000 * 2 ** attempt;
          await this.sleep(delay);
          continue;
        }
        if (error instanceof WikidataUnavailable) throw error;
        throw new WikidataUnavailable('Appel Wikidata impossible', { cause: error });
      }
    }
  }
  private mediawiki<T>(params: Record<string, string>, valid: (raw: T) => boolean, cacheRaw?: (raw: T) => T): Promise<T> {
    const url = new URL('https://www.wikidata.org/w/api.php');
    url.search = new URLSearchParams({ ...params, format: 'json' }).toString();
    return this.request(`mediawiki:${url.searchParams.toString()}`, url, 'application/json', valid, cacheRaw);
  }
  private async entities(ids: string[], props: string): Promise<Record<string, Entity>> {
    const result: Record<string, Entity> = {};
    for (let i = 0; i < ids.length; i += 50) {
      const raw = await this.mediawiki<EntityResponse>({ action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props, languages: 'fr|en' },
        raw => Boolean(raw.entities && typeof raw.entities === 'object' && !Array.isArray(raw.entities)), trimEntities);
      Object.assign(result, raw.entities);
    }
    return result;
  }
  async searchFilms(query: string): Promise<WikidataCandidate[]> {
    query = query.trim();
    if (!query) return [];
    const responses = await Promise.allSettled(['fr', 'en'].map(language => this.mediawiki<{ search: { id: string }[] }>({
      action: 'wbsearchentities', search: query, language, uselang: language, type: 'item', limit: '15',
    }, raw => Array.isArray(raw.search))));
    const failure = responses.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const searches = responses.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const ids = [...new Set(searches.flatMap(raw => raw.search.map(item => item.id)).filter(id => /^Q\d+$/.test(id)))];
    if (!ids.length) return [];
    const entities = await this.entities(ids, 'labels|claims');
    const candidates = ids.flatMap(qid => {
      const entity = entities[qid];
      if (!entity || entityIds(entity, 'P31').includes('Q5398426')) return [];
      const imdbID = values(entity, 'P345').find(value => typeof value === 'string' && /^tt\d{7,10}$/.test(value)) as string | undefined;
      if (!imdbID) return [];
      const original = values(entity, 'P1476').find(value => value && typeof value === 'object' && 'text' in value) as { text: string; language?: string } | undefined;
      const years = values(entity, 'P577').flatMap(value => {
        const time = value && typeof value === 'object' && 'time' in value ? String(value.time) : '';
        const year = Number(/^\+(\d{4})-/.exec(time)?.[1]);
        return Number.isFinite(year) && year > 0 ? [year] : [];
      });
      return [{ imdbID, qid, titleFr: entity.labels?.fr?.value ?? null, titleEn: entity.labels?.en?.value ?? null,
        originalTitle: original?.text ?? null, originalLanguage: original?.language ?? null,
        year: years.length ? Math.min(...years) : null, directorIds: entityIds(entity, 'P57') }];
    });
    const directors = await this.entities([...new Set(candidates.flatMap(c => c.directorIds))], 'labels');
    const seen = new Set<string>();
    return candidates.flatMap(({ directorIds, ...candidate }) => {
      if (seen.has(candidate.imdbID)) return [];
      seen.add(candidate.imdbID);
      return [{ ...candidate, directors: [...new Set(directorIds.flatMap(id => label(directors[id]) ? [label(directors[id])!] : []))] }];
    });
  }
  async byImdb(id: string): Promise<WikidataData> {
    id = normalizeImdb(id);
    const query = `SELECT ?filmLabel ?originalTitle ?role ?name ?frWiki WHERE {
      ?film wdt:P345 "${id}" .
      OPTIONAL { ?film rdfs:label ?filmLabel . FILTER(LANG(?filmLabel) = "fr") }
      OPTIONAL { ?film wdt:P1476 ?originalTitle }
      OPTIONAL { ?frArticle schema:about ?film ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?frWiki }
      OPTIONAL {
        VALUES (?property ?role) {
          (wdt:P86 "composer") (wdt:P344 "cinematographer") (wdt:P1040 "editor")
          (wdt:P162 "producer") (wdt:P58 "writer") (wdt:P272 "company")
        }
        ?film ?property ?person .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en" . ?person rdfs:label ?name . }
      }
    } ORDER BY ?role ?name`;
    const url = new URL('https://query.wikidata.org/sparql');
    url.searchParams.set('query', query); url.searchParams.set('format', 'json');
    return this.request<WikidataData>(`imdb:v3:${id}`, url, 'application/sparql-results+json', raw => Array.isArray(raw.results?.bindings));
  }
  async frenchSynopsis(title: string): Promise<string | null> {
    const url = new URL('https://fr.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'wiki',
      redirects: '1', titles: title, format: 'json', formatversion: '2' }).toString();
    const raw = await this.request<{ query?: { pages?: { extract?: string }[] } }>(`synopsis:v1:${title}`, url,
      'application/json', raw => Array.isArray(raw.query?.pages), undefined, 'wikipedia');
    return extractFrenchSynopsis(raw.query?.pages?.[0]?.extract ?? '');
  }
}

export function parseWikidata(data: WikidataData) {
  const credits: Credit[] = [], companies: Company[] = [];
  const seen = new Set<string>();
  let titleFr: string | null = null, originalTitle: string | null = null, frwikiTitle: string | null = null;
  const roles = new Set(['composer', 'cinematographer', 'editor', 'producer', 'writer']);
  for (const binding of data.results.bindings) {
    titleFr ??= binding.filmLabel?.value ?? null;
    originalTitle ??= binding.originalTitle?.value ?? null;
    frwikiTitle ??= binding.frWiki?.value ?? null;
    const role = binding.role?.value, name = binding.name?.value.trim();
    if (!role || !name || seen.has(`${role}:${name.toLocaleLowerCase()}`)) continue;
    seen.add(`${role}:${name.toLocaleLowerCase()}`);
    if (role === 'company') companies.push({ name, source: 'wikidata' });
    else if (roles.has(role)) credits.push({ role: role as Role, name,
      position: credits.filter(c => c.role === role).length, source: 'wikidata' });
  }
  return { title_fr: titleFr, original_title: originalTitle, frwiki_title: frwikiTitle, credits, companies };
}

export function extractFrenchSynopsis(extract: string): string | null {
  const headings = [...extract.matchAll(/^==[ \t]*([^=\r\n]+?)[ \t]*==[ \t]*\r?$/gm)];
  const index = headings.findIndex(match => ['synopsis', 'resume', 'intrigue', 'histoire', 'scenario'].includes(normalizeTitle(match[1]!)));
  if (index < 0) return null;
  const heading = headings[index]!;
  const body = extract.slice(heading.index + heading[0].length, headings[index + 1]?.index)
    .replace(/^={3,}.*?={3,}[ \t]*\r?$/gm, '').trim()
    .split(/\r?\n\s*\r?\n/).map(paragraph => paragraph.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n');
  if (body.length < 40) return null;
  if (body.length <= 2000) return body;
  const capped = body.slice(0, 2000);
  const end = [...capped.matchAll(/[.!?…][»”"']?(?=\s|$)/g)].at(-1);
  return end ? capped.slice(0, end.index + end[0].length) : capped.slice(0, capped.lastIndexOf(' ')).trimEnd();
}
