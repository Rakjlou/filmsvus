import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { FastifyError } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { openDatabase } from './db/index.ts';
import { FilmsRepo } from './repo/films.ts';
import { OmdbClient } from './services/omdb.ts';
import { WikidataClient } from './services/wikidata.ts';
import { Hydrator } from './services/hydrate.ts';
import { createThrottle } from './services/network.ts';
import type { Fetch } from './services/network.ts';
import { filmRoutes } from './routes/films.ts';
import { tagRoutes } from './routes/tags.ts';
import { viewerRoutes } from './routes/viewers.ts';
import { statsRoutes } from './routes/stats.ts';
import { searchRoutes } from './routes/search.ts';

interface AppOptions {
  db?: DatabaseSync; fetch?: Fetch; logger?: boolean; production?: boolean;
  postersDir?: string; distDir?: string; backgroundHydration?: boolean;
  dailyBudget?: number; apiKey?: string; throttleMs?: number;
}
export function buildApp(options: AppOptions = {}) {
  const db = options.db ?? openDatabase();
  const repo = new FilmsRepo(db);
  const app = Fastify({ logger: options.logger ?? false, ajv: { customOptions: { removeAdditional: false } } });
  const throttle = createThrottle(options.throttleMs ?? 1000);
  const omdb = new OmdbClient(db, { fetch: options.fetch, apiKey: options.apiKey, dailyBudget: options.dailyBudget, throttle });
  const wikidata = new WikidataClient(db, { fetch: options.fetch, throttle });
  const postersDir = resolve(options.postersDir ?? process.env.POSTERS_DIR ?? 'data/posters');
  const hydrator = new Hydrator(repo, omdb, wikidata, { fetch: options.fetch, postersDir });
  const jobs = new Set<Promise<unknown>>();
  const schedule = (id: number) => {
    if (options.backgroundHydration === false) return;
    const job = new Promise<void>(done => setImmediate(done)).then(() => hydrator.hydrateFilm(id))
      .catch((error: unknown) => { app.log.warn({ film_id: id, err: error }, 'Hydratation différée incomplète'); })
      .finally(() => jobs.delete(job));
    jobs.add(job);
  };
  app.addHook('onClose', async () => {
    await Promise.allSettled(jobs);
    if (!options.db) db.close();
  });
  app.setErrorHandler((thrown, _request, reply) => {
    const error = thrown as FastifyError;
    if (error.validation) return reply.code(400).send({ error: 'Validation', message: error.message });
    const sqlite = error as Error & { errcode?: number };
    // Extended SQLite constraint codes all share the low byte 19.
    if (sqlite.errcode !== undefined && (sqlite.errcode & 255) === 19) {
      const status = [1555, 2067].includes(sqlite.errcode) ? 409 : 400;
      return reply.code(status).send({ error: 'Constraint', message: status === 409 ? 'Cette entrée existe déjà' : 'Référence ou valeur invalide' });
    }
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status === 500) app.log.error(error);
    return reply.code(status).send({ error: error.name, message: status === 500 ? 'Erreur interne' : error.message });
  });
  filmRoutes(app, repo, hydrator, schedule);
  tagRoutes(app, repo);
  viewerRoutes(app, repo);
  statsRoutes(app, repo);
  searchRoutes(app, omdb, wikidata);
  mkdirSync(postersDir, { recursive: true });
  app.register(fastifyStatic, { root: postersDir, prefix: '/posters/', decorateReply: false, index: false });
  const distDir = resolve(options.distDir ?? 'dist');
  if ((options.production ?? process.env.NODE_ENV === 'production') && existsSync(distDir)) {
    app.register(fastifyStatic, { root: distDir, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split('?')[0]!;
      if (['GET', 'HEAD'].includes(request.method) && !/^\/(api|posters)(\/|$)/.test(pathname) && !extname(pathname)) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not Found' });
    });
  }
  return app;
}

if (import.meta.main) {
  const app = buildApp({ logger: true, production: process.argv.includes('--production') || process.env.NODE_ENV === 'production' });
  const shutdown = () => { app.close().catch(error => { app.log.error(error); process.exitCode = 1; }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try { await app.listen({ port: Number(process.env.PORT ?? 3210), host: '127.0.0.1' }); }
  catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
}
