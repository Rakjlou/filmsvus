import type { FastifyInstance } from 'fastify';
import { InvalidInput } from '../repo/films.ts';
import type { ReratesRepo } from '../repo/rerates.ts';
import { idParams, rerateBody, rerateQuery } from './schemas.ts';

export function rerateRoutes(app: FastifyInstance, repo: ReratesRepo) {
  const options = {
    schema: { params: idParams },
    schemaErrorFormatter: () => new Error('Requête de renote invalide : vérifiez les identifiants et les notes entières de 0 à 10.'),
  };
  app.get<{ Querystring: { exclude?: string } }>('/api/rerate/next', {
    ...options, config: { auth: 'required' }, schema: { querystring: rerateQuery },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const exclude = request.query.exclude?.split(',').map(Number) ?? [];
    return repo.next(exclude);
  });
  app.post<{ Params: { id: number }; Body: { scores: Record<string, number> } }>('/api/rerate/:id', {
    ...options, schema: { ...options.schema, body: rerateBody },
    // Keep JSON numbers strict: AJV's usual coercion would accept null, booleans or strings.
    preValidation: async request => {
      const scores = request.body?.scores;
      if (scores && Object.values(scores).some(score => typeof score !== 'number')) {
        throw new InvalidInput('Les deux notes doivent être des nombres entiers de 0 à 10.');
      }
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return repo.rate(request.params.id, request.body.scores);
  });
  app.post<{ Params: { id: number } }>('/api/rerate/:id/ignore', {
    ...options,
  }, async (request, reply) => {
    repo.ignore(request.params.id);
    return reply.code(204).send();
  });
  app.delete<{ Params: { id: number } }>('/api/rerate/:id', {
    ...options,
  }, async (request, reply) => {
    repo.delete(request.params.id);
    return reply.code(204).send();
  });
}
