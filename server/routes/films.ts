import type { FastifyInstance } from 'fastify';
import type { FilmInput, FilmsRepo, RatingInput } from '../repo/films.ts';
import type { Hydrator } from '../services/hydrate.ts';
import { idParams, createFilmBody, patchFilmBody, ratingsBody, tagsBody } from './schemas.ts';

export function filmRoutes(app: FastifyInstance, repo: FilmsRepo, hydrator: Hydrator, schedule: (id: number) => void) {
  app.get('/api/films', async () => repo.list());
  app.post<{ Body: FilmInput & { title: string } }>('/api/films', { schema: { body: createFilmBody } }, async (request, reply) => {
    const film = repo.create(request.body);
    schedule(film.id);
    return reply.code(201).header('Location', `/api/films/${film.id}`).send(film);
  });
  app.get<{ Params: { id: number } }>('/api/films/:id', { schema: { params: idParams } }, async request => repo.get(request.params.id));
  app.patch<{ Params: { id: number }; Body: FilmInput }>('/api/films/:id', {
    schema: { params: idParams, body: patchFilmBody },
  }, async request => repo.patch(request.params.id, request.body));
  app.delete<{ Params: { id: number } }>('/api/films/:id', { schema: { params: idParams } }, async (request, reply) => {
    repo.delete(request.params.id);
    return reply.code(204).send();
  });
  app.put<{ Params: { id: number }; Body: { ratings: RatingInput[] } }>('/api/films/:id/ratings', {
    schema: { params: idParams, body: ratingsBody },
  }, async request => repo.setRatings(request.params.id, request.body.ratings));
  app.put<{ Params: { id: number }; Body: { tag_ids: number[] } }>('/api/films/:id/tags', {
    schema: { params: idParams, body: tagsBody },
  }, async request => repo.setTags(request.params.id, request.body.tag_ids));
  app.post<{ Params: { id: number } }>('/api/films/:id/hydrate', {
    schema: { params: idParams },
  }, async request => hydrator.hydrateFilm(request.params.id));
}
