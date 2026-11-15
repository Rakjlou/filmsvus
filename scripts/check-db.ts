import { inspectDatabase } from '../server/db/export.ts';
import { SUPPORTED_DB_VERSION } from '../server/db/index.ts';

export function checkDatabase(path: string) {
  const result = inspectDatabase(path);
  if (result.user_version > SUPPORTED_DB_VERSION) {
    throw new Error(`Unsupported database version: ${result.user_version} (maximum ${SUPPORTED_DB_VERSION}).`);
  }
  return result;
}

if (import.meta.main) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/check-db.ts <films.db>');
  console.log(JSON.stringify(checkDatabase(process.argv[2]!)));
}
