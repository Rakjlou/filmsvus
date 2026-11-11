import type { FastifyInstance } from 'fastify';
import type { FilmsRepo } from '../repo/films.ts';

export function viewerRoutes(app: FastifyInstance, repo: FilmsRepo) {
  app.get('/api/viewers', async () => repo.viewers());
}
