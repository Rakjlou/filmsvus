import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const sessionCookie = 'filmsvus_session';
export const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
export const sessionRenewalWindow = 15 * 24 * 60 * 60 * 1000;
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export class Unauthorized extends Error {
  statusCode = 401;
  constructor(message = 'Connexion requise') { super(message); this.name = 'Unauthorized'; }
}
export class Forbidden extends Error {
  statusCode = 403;
  constructor() { super('Origine de la requête non autorisée'); this.name = 'Forbidden'; }
}

interface Session { username: string; expires_at: string }
function sessionStore(db: DatabaseSync) {
  const sweep = db.prepare('DELETE FROM sessions WHERE expires_at<=?');
  const insert = db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)');
  const find = db.prepare(`SELECT u.username,s.expires_at FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`);
  const renew = db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=? AND expires_at>? AND expires_at<?');
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash=?');
  const revoke = db.prepare('DELETE FROM sessions WHERE user_id=?');
  return {
    createSession(userId: number, now: number) {
      const token = randomBytes(32).toString('base64url');
      sweep.run(new Date(now).toISOString());
      insert.run(tokenHash(token), userId, new Date(now).toISOString(), new Date(now + sessionLifetime).toISOString());
      return token;
    },
    findSession(token: string, now: number) {
      return find.get(tokenHash(token), new Date(now).toISOString()) as Session | undefined;
    },
    renewSession(token: string, now: number) {
      return renew.run(new Date(now + sessionLifetime).toISOString(), tokenHash(token),
        new Date(now).toISOString(), new Date(now + sessionRenewalWindow).toISOString()).changes > 0;
    },
    deleteSession(token: string) { remove.run(tokenHash(token)); },
    deleteUserSessions(userId: number) { revoke.run(userId); },
  };
}
const stores = new WeakMap<DatabaseSync, ReturnType<typeof sessionStore>>();
export function createAuth(db: DatabaseSync) {
  let store = stores.get(db);
  if (!store) { store = sessionStore(db); stores.set(db, store); }
  return store;
}
