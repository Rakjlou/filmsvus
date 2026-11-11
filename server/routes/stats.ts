import type { FastifyInstance } from 'fastify';
import type { FilmsRepo } from '../repo/films.ts';
import { computeStats } from '../repo/stats.ts';

export function statsRoutes(app: FastifyInstance, repo: FilmsRepo) {
  app.get('/api/stats', async () => computeStats(repo.list(), repo.viewers()));
}
