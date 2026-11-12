import { normalizeTitle } from '../shared/titles.ts';

export function displayTitles(film: { title: string; title_fr?: string | null; original_title?: string | null }) {
  const original = film.original_title?.trim(), french = film.title_fr?.trim();
  if (original && !/\p{Script=Latin}/u.test(original)) return { main: french || film.title, secondary: original };
  const main = original || film.title;
  // When a French label exists, do not fall through to OMDb's English title.
  const secondary = french || film.title;
  return { main, secondary: normalizeTitle(secondary) === normalizeTitle(main) ? null : secondary };
}
