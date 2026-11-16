import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import type { DatabaseSync } from 'node:sqlite';
import { createUsers } from '../services/users.ts';
import { createAuth, Forbidden, Unauthorized, sessionCookie, sessionLifetime } from '../services/auth.ts';
import { loginBody } from './schemas.ts';

declare module 'fastify' {
  interface FastifyRequest { user: { username: string } | null }
  interface FastifyContextConfig { auth?: 'required' | 'public' }
}

const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLoopback = (address: string | undefined) => loopbackAddresses.has(address ?? '');

interface AuthOptions { db: DatabaseSync; secure: boolean; now: () => number }
export function registerAuth(app: FastifyInstance, { db, secure, now }: AuthOptions) {
  const sessions = createAuth(db), users = createUsers(db);
  const cookieOptions = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: sessionLifetime / 1000, secure } as const;
  app.register(fastifyCookie);
  app.register(fastifyRateLimit, {
    global: false,
    keyGenerator: request => request.ip,
    errorResponseBuilder: () => Object.assign(new Error('Trop de tentatives de connexion. Réessayez dans 15 minutes.'), {
      name: 'TooManyRequests', statusCode: 429,
    }),
  });
  app.decorateRequest('user', null);

  function readSession(request: FastifyRequest) {
    const token = request.cookies[sessionCookie];
    const session = token ? sessions.findSession(token, now()) : undefined;
    if (session) request.user = { username: session.username };
    return request.user;
  }
  function renewSession(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[sessionCookie];
    if (request.user && token && sessions.renewSession(token, now())) {
      reply.setCookie(sessionCookie, token, cookieOptions);
      reply.header('Cache-Control', 'no-store');
    }
  }

  // Install cookie parsing and rate-limit's onRoute hook before the guard/routes.
  app.after(() => {
    app.addHook('onRequest', async (request, reply) => {
      const path = request.routeOptions.url ?? request.url.split('?')[0]!;
      if (!path.startsWith('/api/')) return;
      const mutation = !['GET', 'HEAD'].includes(request.method);
      const policy = request.routeOptions.config.auth ?? (mutation ? 'required' : 'public');
      if (policy === 'required' && !readSession(request)) throw new Unauthorized();
      // Protect login as well as authenticated writes from cross-origin submissions.
      if (mutation && request.headers.origin) {
        const forwarded = isLoopback(request.raw.socket.remoteAddress) ? request.headers['x-forwarded-host'] : undefined;
        const host = typeof forwarded === 'string' ? forwarded : request.headers.host;
        let sameHost = false;
        try { sameHost = new URL(request.headers.origin).host.toLowerCase() === host?.toLowerCase(); } catch { /* Reject invalid origins. */ }
        if (!sameHost) throw new Forbidden();
      }
      if (policy === 'required') renewSession(request, reply);
    });
    app.register(async auth => {
      auth.addHook('onSend', async (_request, reply, payload) => {
        reply.header('Cache-Control', 'no-store');
        return payload;
      });
      auth.post<{ Body: { username: string; password: string } }>('/login', {
        config: { auth: 'public', rateLimit: { max: 10, timeWindow: 15 * 60 * 1000 } },
        schema: { body: loginBody },
      }, async (request, reply) => {
        const { username, password } = request.body;
        const user = await users.authenticate(username, password);
        if (!user) throw new Unauthorized('Identifiant ou mot de passe incorrect');
        const token = sessions.createSession(user.id, now());
        return reply.setCookie(sessionCookie, token, cookieOptions).send({ user: { username: user.username } });
      });
      auth.post('/logout', { config: { auth: 'public' } }, async (request, reply) => {
        const token = request.cookies[sessionCookie];
        if (token) sessions.deleteSession(token);
        return reply.clearCookie(sessionCookie, cookieOptions).code(204).send();
      });
      auth.get('/me', async (request, reply) => {
        const user = readSession(request);
        renewSession(request, reply);
        return { user };
      });
    }, { prefix: '/api/auth' });
  });
}
