import type { FastifyInstance } from 'fastify';
import type { FilmsRepo, Tag } from '../repo/films.ts';
import { tagBody } from './schemas.ts';

export function tagRoutes(app: FastifyInstance, repo: FilmsRepo) {
  app.get('/api/tags', async () => repo.tags());
  app.post<{ Body: Omit<Tag, 'id'> }>('/api/tags', { schema: { body: tagBody } }, async (request, reply) => {
    const { label, emoji, color } = request.body;
    return reply.code(201).send(repo.createTag({ label: label.trim(), emoji: emoji ?? null, color: color ?? null }));
  });
}
