import { parseArgs } from 'node:util';
import { openDatabase } from '../server/db/index.ts';
import { FilmsRepo } from '../server/repo/films.ts';
import { OmdbClient, BudgetExceeded } from '../server/services/omdb.ts';
import { WikidataClient } from '../server/services/wikidata.ts';
import { Hydrator } from '../server/services/hydrate.ts';
import { createThrottle } from '../server/services/network.ts';

export function parseOptions(args: string[]) {
  const { values } = parseArgs({ args, options: {
    limit: { type: 'string', default: '20' }, 'dry-run': { type: 'boolean', default: false }, id: { type: 'string' },
  } });
  const integer = (value: string, name: string) => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(`${name} doit être un entier supérieur à zéro`);
    return Number(value);
  };
  return { limit: integer(values.limit!, '--limit'), dryRun: values['dry-run']!, id: values.id ? integer(values.id, '--id') : undefined };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const db = openDatabase();
  try {
    const repo = new FilmsRepo(db);
    const films = (options.id ? [repo.get(options.id)] : repo.list())
      .filter(f => !f.hydrated && (options.id !== undefined || !f.needs_review)).slice(0, options.limit);
    console.log(`${films.length} film(s) sélectionné(s)${options.dryRun ? ' — simulation, aucun appel réseau' : ''}`);
    if (options.dryRun) {
      for (const film of films) console.log(`${film.id} : ${film.title}`);
      return;
    }
    const throttle = createThrottle();
    const omdb = new OmdbClient(db, { throttle });
    const hydrate = new Hydrator(repo, omdb, new WikidataClient(db, { throttle }));
    let stop = false, hydrated = 0, review = 0, failed = 0;
    const onSignal = () => { stop = true; };
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
    try {
      for (const film of films) {
        if (stop) break;
        try {
          const result = await hydrate.hydrateFilm(film.id);
          if (result.hydrated) hydrated++; else review++;
          console.log(`${film.id} : ${result.hydrated ? 'enrichi' : 'à vérifier'}`);
        } catch (error) {
          if (error instanceof BudgetExceeded) { console.log('Budget OMDb atteint, arrêt propre.'); break; }
          failed++;
          console.error(`${film.id} : ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally { process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); }
    console.log({ hydrated, needs_review: review, failed, budget: omdb.budget() });
    if (failed) process.exitCode = 1;
  } finally { db.close(); }
}

if (import.meta.main) await main();
