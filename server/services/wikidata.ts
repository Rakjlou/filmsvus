import type { DatabaseSync } from 'node:sqlite';
import type { Credit, Company, Role } from '../repo/films.ts';
import { normalizeImdb } from '../repo/films.ts';
import { UpstreamError } from './network.ts';
import type { Fetch, Throttle } from './network.ts';

interface Binding { value: string }
export interface WikidataData {
  results: { bindings: { filmLabel?: Binding; role?: Binding; name?: Binding }[] };
}
interface Options { fetch?: Fetch; throttle?: Throttle; now?: () => Date }
export class WikidataClient {
  db: DatabaseSync; fetch: Fetch; throttle: Throttle; now: () => Date;
  constructor(db: DatabaseSync, options: Options = {}) {
    this.db = db; this.fetch = options.fetch ?? globalThis.fetch;
    this.throttle = options.throttle ?? (() => Promise.resolve());
    this.now = options.now ?? (() => new Date());
  }
  async byImdb(id: string): Promise<WikidataData> {
    id = normalizeImdb(id);
    const cached = this.db.prepare("SELECT raw_response FROM api_log WHERE provider='wikidata' AND request_key=? AND raw_response IS NOT NULL ORDER BY id DESC LIMIT 1").get(id);
    if (cached) return JSON.parse(String(cached.raw_response)) as WikidataData;
    const query = `SELECT ?filmLabel ?role ?name WHERE {
      ?film wdt:P345 "${id}" .
      OPTIONAL { ?film rdfs:label ?filmLabel . FILTER(LANG(?filmLabel) = "fr") }
      OPTIONAL {
        VALUES (?property ?role) {
          (wdt:P86 "composer") (wdt:P344 "cinematographer") (wdt:P1040 "editor")
          (wdt:P162 "producer") (wdt:P58 "writer") (wdt:P272 "company")
        }
        ?film ?property ?person .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en" . ?person rdfs:label ?name . }
      }
    } ORDER BY ?role ?name`;
    await this.throttle();
    const logId = this.db.prepare("INSERT INTO api_log(provider,request_key,status,at) VALUES ('wikidata',?,0,?)")
      .run(id, this.now().toISOString()).lastInsertRowid;
    let status = 0;
    try {
      const url = new URL('https://query.wikidata.org/sparql');
      url.searchParams.set('query', query); url.searchParams.set('format', 'json');
      const response = await this.fetch(url, {
        headers: { 'User-Agent': 'filmsvus-local/0.1', Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(30_000),
      });
      status = response.status;
      if (!response.ok) throw new UpstreamError(`Wikidata HTTP ${status}`);
      const raw = await response.json() as WikidataData;
      if (!Array.isArray(raw?.results?.bindings)) throw new UpstreamError('Réponse Wikidata invalide');
      this.db.prepare('UPDATE api_log SET status=?,raw_response=? WHERE id=?').run(status, JSON.stringify(raw), logId);
      return raw;
    } catch (error) {
      this.db.prepare('UPDATE api_log SET status=? WHERE id=?').run(status, logId);
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError('Appel Wikidata impossible');
    }
  }
}

export function parseWikidata(data: WikidataData) {
  const credits: Credit[] = [], companies: Company[] = [];
  const seen = new Set<string>();
  let titleFr: string | null = null;
  const roles = new Set(['composer', 'cinematographer', 'editor', 'producer', 'writer']);
  for (const binding of data.results.bindings) {
    titleFr ??= binding.filmLabel?.value ?? null;
    const role = binding.role?.value, name = binding.name?.value.trim();
    if (!role || !name || seen.has(`${role}:${name.toLocaleLowerCase()}`)) continue;
    seen.add(`${role}:${name.toLocaleLowerCase()}`);
    if (role === 'company') companies.push({ name, source: 'wikidata' });
    else if (roles.has(role)) credits.push({ role: role as Role, name,
      position: credits.filter(c => c.role === role).length, source: 'wikidata' });
  }
  return { title_fr: titleFr, credits, companies };
}
