import type { WikidataCandidate } from '../../server/services/wikidata.ts';
import type { Fetch } from '../../server/services/network.ts';
import { json } from '../helpers.ts';

export const dansMaPeau: WikidataCandidate = { qid: 'Q1161740', imdbID: 'tt0337961', titleFr: 'Dans ma peau',
  titleEn: 'In My Skin', originalTitle: 'Dans ma peau', originalLanguage: 'fr', year: 2002, directors: ['Marina de Van'] };
export const knivesOut: WikidataCandidate = { qid: 'Q57982486', imdbID: 'tt8946378', titleFr: 'À couteaux tirés',
  titleEn: 'Knives Out', originalTitle: 'Knives Out', originalLanguage: 'en', year: 2019, directors: ['Rian Johnson'] };
export const knivesHomonyms: WikidataCandidate[] = [knivesOut,
  { qid: 'Q121313', imdbID: 'tt0119051', titleFr: 'À couteaux tirés', titleEn: 'The Edge', originalTitle: 'The Edge',
    originalLanguage: 'en', year: 1997, directors: ['Lee Tamahori'] },
  { qid: 'Q121314', imdbID: 'tt0057663', titleFr: 'À couteaux tirés', titleEn: null, originalTitle: 'À couteaux tirés',
    originalLanguage: 'fr', year: 1963, directors: ['Charles Gérard'] },
];
export const parasite: WikidataCandidate = { qid: 'Q61448040', imdbID: 'tt6751668', titleFr: 'Parasite',
  titleEn: 'Parasite', originalTitle: '기생충', originalLanguage: 'ko', year: 2019, directors: ['Bong Joon-ho'] };
export const parasiteHomonyms: WikidataCandidate[] = [
  { qid: 'Q121315', imdbID: 'tt0084472', titleFr: 'Parasite', titleEn: 'Parasite', originalTitle: 'Parasite',
    originalLanguage: 'en', year: 1982, directors: ['Charles Band'] }, parasite,
  { qid: 'Q121316', imdbID: 'tt0352699', titleFr: 'Parasite', titleEn: 'Parasite', originalTitle: 'Parasite',
    originalLanguage: 'en', year: 2004, directors: ['Andrew Prendergast'] },
];

// MediaWiki-shaped fixtures: labels and statement mainsnaks, including no-value claims.
function statement(property: string, value: unknown) {
  const type = typeof value === 'string' ? 'string' : value && typeof value === 'object' && 'text' in value
    ? 'monolingualtext' : value && typeof value === 'object' && 'time' in value ? 'time' : 'wikibase-entityid';
  return { type: 'statement', rank: 'normal', mainsnak: { snaktype: 'value', property,
    datavalue: { value, type } } };
}
const item = (id: string) => ({ 'entity-type': 'item', 'numeric-id': Number(id.slice(1)), id });
export function wikidataFixture(candidates: WikidataCandidate[], options: { fr?: string[]; en?: string[]; noise?: boolean } = {}) {
  const entities: Record<string, unknown> = {}, people: Record<string, unknown> = {};
  let nextDirector = 1000;
  for (const candidate of candidates) {
    const directorIds = candidate.directors.map(name => {
      const id = `Q${nextDirector++}`;
      // Alternate French and English labels to exercise the name fallback.
      people[id] = { id, type: 'item', labels: { [nextDirector % 2 ? 'fr' : 'en']: { language: nextDirector % 2 ? 'fr' : 'en', value: name } } };
      return id;
    });
    entities[candidate.qid] = { id: candidate.qid, type: 'item', labels: {
      ...(candidate.titleFr ? { fr: { language: 'fr', value: candidate.titleFr } } : {}),
      ...(candidate.titleEn ? { en: { language: 'en', value: candidate.titleEn } } : {}),
    }, claims: {
      P31: [statement('P31', item('Q11424'))], P345: [statement('P345', candidate.imdbID)],
      P57: directorIds.map(id => statement('P57', item(id))),
      P1476: candidate.originalTitle ? [statement('P1476', { text: candidate.originalTitle, language: candidate.originalLanguage })] : [],
      P577: candidate.year ? [statement('P577', { time: `+${candidate.year + 1}-01-01T00:00:00Z`, precision: 11 }),
        { mainsnak: { snaktype: 'novalue', property: 'P577' } },
        statement('P577', { time: `+${candidate.year}-09-15T00:00:00Z`, precision: 11 })] : [],
    } };
  }
  if (options.noise) {
    entities.Q900 = { id: 'Q900', claims: { P31: [statement('P31', item('Q4167410'))] } };
    entities.Q901 = { id: 'Q901', claims: { P345: [statement('P345', 'nm1234567')] } };
    entities.Q902 = { id: 'Q902', claims: { P345: [statement('P345', 'tt9999999')], P31: [statement('P31', item('Q5398426'))] } };
    entities.Q903 = { id: 'Q903', missing: '' };
  }
  const ids = candidates.map(c => c.qid);
  const calls: URL[] = [];
  const fetch: Fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname !== 'www.wikidata.org') throw new Error(`Unexpected fixture URL: ${url.hostname}`);
    if ((init?.headers as Record<string, string>)?.['User-Agent'] !== 'filmsvus-local/0.1' || !init?.signal) throw new Error('Missing User-Agent or timeout');
    if (url.searchParams.get('action') === 'wbsearchentities') {
      const found = url.searchParams.get('language') === 'fr' ? options.fr ?? ids : options.en ?? ids;
      return json({ success: 1, search: found.map(id => ({ id, label: id, match: { type: 'label', language: url.searchParams.get('language') } })) });
    }
    const source = url.searchParams.get('props') === 'labels' ? people : entities;
    return json({ success: 1, entities: Object.fromEntries(url.searchParams.get('ids')!.split('|').map(id => [id, source[id] ?? { id, missing: '' }])) });
  };
  return { fetch, calls };
}
