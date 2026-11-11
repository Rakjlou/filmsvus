import type { Candidate, SearchCandidate } from './types.ts';

export function normalizeCandidate(candidate: Candidate): SearchCandidate {
  if ('title' in candidate) return candidate;
  return { imdbID: candidate.imdbID, title: candidate.Title, originalTitle: null, englishTitle: candidate.Title,
    year: /^\d{4}$/.test(candidate.Year ?? '') ? Number(candidate.Year) : null,
    directors: candidate.Director && candidate.Director !== 'N/A' ? candidate.Director.split(',').map(name => name.trim()) : [],
    poster: candidate.Poster && candidate.Poster !== 'N/A' ? candidate.Poster : null, source: 'omdb' };
}

export function candidateSelection(candidate: Candidate, query: string): SearchCandidate {
  const normalized = normalizeCandidate(candidate), typed = query.trim();
  return { ...normalized, title: typed.toLocaleLowerCase('fr') === normalized.title.toLocaleLowerCase('fr') ? typed : normalized.title };
}
