import { DatabaseSync } from 'node:sqlite';
import { OmdbClient } from '../server/services/omdb.ts';

const db = new DatabaseSync(process.env.DB_PATH ?? 'data/films.db', { readOnly: true });
try { console.log(JSON.stringify(new OmdbClient(db).budget(), null, 2)); }
finally { db.close(); }
