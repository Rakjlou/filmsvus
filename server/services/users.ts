import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db/index.ts';
import { createAuth } from './auth.ts';

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number,
  options: ScryptOptions & { maxmem: number }) => Promise<Buffer>;
export interface ScryptOptions { N: number; r: number; p: number }
export const defaultScrypt: ScryptOptions = { N: 32768, r: 8, p: 1 };
export const usernamePattern = /^[a-zA-Z0-9._-]{2,32}$/;
export interface User { id: number; username: string; password_hash: string; created_at: string }
export class UserError extends Error {}

// Precomputed from a discarded random password at the default cost. Missing users
// still perform one verification, without an extra scrypt on the first login.
const dummyHash = 'scrypt$32768$8$1$37cqbJUBtX-X1uFKVX0yOA$qkUprBJYhzI22qJPmO-eGOqtmH9PBHDMcLzn5xYPb_4';

async function key(password: string, salt: Buffer, length: number, options: ScryptOptions) {
  return await derive(password, salt, length, { ...options, maxmem: 128 * options.N * options.r + 32 * 1024 * 1024 });
}
export async function hashPassword(password: string, options = defaultScrypt): Promise<string> {
  if ([...password].length < 10 || password.length > 1024) throw new UserError('Le mot de passe doit contenir entre 10 et 1024 caractères.');
  const salt = randomBytes(16), hash = await key(password, salt, 32, options);
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    // Bound work and memory for corrupt DB rows; scrypt validates the parameters.
    if (!(N <= 131072 && r <= 16 && p <= 8)) return false;
    const salt = Buffer.from(parts[4]!, 'base64url'), expected = Buffer.from(parts[5]!, 'base64url');
    const actual = await key(password, salt, 32, { N, r, p });
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}
function userStore(db: DatabaseSync) {
  const lookup = db.prepare('SELECT * FROM users WHERE username=?');
  const findUser = (username: string) => lookup.get(username) as User | undefined;
  return {
    findUser,
    async authenticate(username: string, password: string) {
      const user = findUser(username);
      const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
      // A concurrent CLI password change/removal invalidates an in-flight login.
      if (!user || !valid || findUser(username)?.password_hash !== user.password_hash) return undefined;
      return user;
    },
  };
}
const stores = new WeakMap<DatabaseSync, ReturnType<typeof userStore>>();
export function createUsers(db: DatabaseSync) {
  let store = stores.get(db);
  if (!store) { store = userStore(db); stores.set(db, store); }
  return store;
}
export function findUser(db: DatabaseSync, username: string) { return createUsers(db).findUser(username); }
export function validateUsername(username: string) {
  if (!usernamePattern.test(username)) throw new UserError('Identifiant : 2 à 32 lettres, chiffres, points, tirets ou underscores.');
}
export async function addUser(db: DatabaseSync, username: string, password: string, options = defaultScrypt) {
  validateUsername(username);
  const hash = await hashPassword(password, options);
  db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES (?,?,?)').run(username, hash, new Date().toISOString());
  return { username };
}
export async function changePassword(db: DatabaseSync, username: string, password: string, options = defaultScrypt) {
  const hash = await hashPassword(password, options);
  transaction(db, () => {
    const user = findUser(db, username);
    if (!user) throw new UserError('Compte introuvable.');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
    createAuth(db).deleteUserSessions(user.id);
  });
}
export function removeUser(db: DatabaseSync, username: string) {
  if (!db.prepare('DELETE FROM users WHERE username=?').run(username).changes) throw new UserError('Compte introuvable.');
}
export function listUsers(db: DatabaseSync) {
  return db.prepare('SELECT username,created_at FROM users ORDER BY username').all() as { username: string; created_at: string }[];
}
