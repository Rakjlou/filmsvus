import type { FastifyInstance } from 'fastify';
import type { OmdbClient } from '../services/omdb.ts';

export function searchRoutes(app: FastifyInstance, omdb: OmdbClient) {
  app.get<{ Querystring: { q: string } }>('/api/search', { schema: { querystring: {
    type: 'object', required: ['q'], additionalProperties: false,
    properties: { q: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' } },
  } } }, async request => omdb.search(request.query.q));
  app.get('/api/omdb/budget', async () => omdb.budget());
}
