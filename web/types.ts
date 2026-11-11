export type { Film, FilmInput, Tag, Viewer, Role, RatingInput } from '../server/repo/films.ts';
import type { computeStats } from '../server/repo/stats.ts';
export type Stats = ReturnType<typeof computeStats>;
export interface Candidate { Title: string; Year?: string; imdbID: string; Poster?: string; Plot?: string; Director?: string }
export interface SearchResponse { Response: string; Search?: Candidate[]; Error?: string; totalResults?: string }
