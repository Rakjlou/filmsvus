import type { FastifyInstance } from 'fastify';
import type { OmdbClient } from '../services/omdb.ts';
import type { WikidataClient } from '../services/wikidata.ts';

export interface SearchCandidate {
  imdbID: string; title: string; originalTitle: string | null; englishTitle: string | null;
  year: number | null; directors: string[]; poster: string | null; source: 'wikidata' | 'omdb';
}

export function searchRoutes(app: FastifyInstance, omdb: OmdbClient, wikidata: WikidataClient) {
  app.get<{ Querystring: { q: string; source?: 'omdb' } }>('/api/search', { config: { auth: 'required' }, schema: { querystring: {
    type: 'object', required: ['q'], additionalProperties: false,
    properties: { q: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' }, source: { const: 'omdb' } },
  } } }, async request => {
    let wikidataError = false;
    if (request.query.source !== 'omdb') {
      try {
        const candidates = await wikidata.searchFilms(request.query.q);
        if (candidates.length) return { Response: 'True', Search: candidates.map((c): SearchCandidate => ({
          imdbID: c.imdbID, title: c.titleFr ?? c.originalTitle ?? c.titleEn ?? c.imdbID,
          originalTitle: c.originalTitle, englishTitle: c.titleEn, year: c.year, directors: c.directors,
          poster: null, source: 'wikidata',
        })), totalResults: String(candidates.length), budget: omdb.budget() };
      } catch { wikidataError = true; }
    }
    const data = await omdb.search(request.query.q);
    return { ...data, Search: (data.Search ?? []).filter(c => c.imdbID).map((c): SearchCandidate => ({
      imdbID: c.imdbID!, title: c.Title ?? c.imdbID!, originalTitle: null, englishTitle: c.Title ?? null,
      year: /^\d{4}$/.test(c.Year ?? '') ? Number(c.Year) : null,
      directors: c.Director && c.Director !== 'N/A' ? c.Director.split(',').map(name => name.trim()) : [],
      poster: c.Poster && c.Poster !== 'N/A' ? c.Poster : null, source: 'omdb',
    })), budget: omdb.budget(), ...(wikidataError ? { wikidataError: true } : {}) };
  });
  app.get('/api/omdb/budget', { config: { auth: 'required' } }, async () => omdb.budget());
}
