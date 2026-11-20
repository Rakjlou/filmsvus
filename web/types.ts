export type { Film, FilmInput, Tag, Viewer, Role, RatingInput } from '../server/repo/films.ts';
export type { Rerate, RerateReveal, RerateScore } from '../server/repo/films.ts';
export type { BlindFilm, RerateNext } from '../server/repo/rerates.ts';
import type { computeStats } from '../server/repo/stats.ts';
export type Stats = ReturnType<typeof computeStats>;
import type { SearchCandidate } from '../server/routes/search.ts';
export type { SearchCandidate };
export interface LegacyCandidate { Title: string; Year?: string; imdbID: string; Poster?: string; Plot?: string; Director?: string }
export type Candidate = SearchCandidate | LegacyCandidate;
export interface SearchResponse { Response: string; Search?: Candidate[]; Error?: string; totalResults?: string; wikidataError?: boolean }
