import { useEffect, useId, useRef, useState } from 'react';
import type { Candidate, SearchResponse } from '../types.ts';
import { api, message } from '../api.ts';
import { Poster } from './Poster.tsx';
import { Icon } from './Icon.tsx';
import { Empty, ErrorMessage } from './Feedback.tsx';
import { candidateSelection, normalizeCandidate } from '../search.ts';

export function FilmSearch({ initialQuery = '', initialResults, onSelect, disabled = false }: { initialQuery?: string; initialResults?: Candidate[]; onSelect: (candidate: Candidate) => void; disabled?: boolean }) {
  const [query, setQuery] = useState(initialQuery), [results, setResults] = useState<Candidate[] | undefined>(initialResults);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [wikidataError, setWikidataError] = useState(false);
  const [validation, setValidation] = useState('');
  const [submitted, setSubmitted] = useState(initialQuery);
  const hintId = useId(), input = useRef<HTMLInputElement>(null);
  useEffect(() => setResults(initialResults), [initialResults]);
  async function search(submittedQuery: string, source?: 'omdb') {
    if (disabled || busy) return;
    const title = submittedQuery.trim();
    if (!title) { setValidation('Saisissez un titre pour rechercher un film.'); input.current?.focus(); return; }
    setValidation('');
    setBusy(true); setError(''); setWikidataError(false); setResults(undefined); setSubmitted(title);
    try {
      const response = await api<SearchResponse>(`/search?q=${encodeURIComponent(title)}${source ? '&source=omdb' : ''}`);
      setResults(response.Search ?? []);
      setWikidataError(Boolean(response.wikidataError));
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <div className="film-search"><form className="search-form" onSubmit={event => { event.preventDefault(); void search(String(new FormData(event.currentTarget).get('q') ?? '')); }}>
    <label>Le titre du film<span className="search-field"><Icon name="search" /><input ref={input} name="q" type="search" maxLength={200} value={query} onChange={e => { setQuery(e.target.value); setValidation(''); }} placeholder="Quel film avez-vous vu ?" aria-invalid={Boolean(validation)} aria-describedby={hintId} disabled={disabled || busy} /></span></label><button type="submit" className="primary" disabled={disabled || busy}>{busy ? 'Recherche…' : 'Rechercher'}</button>
  </form><p id={hintId} className="hint" role={validation ? 'alert' : undefined}>{validation || 'La recherche se lance uniquement avec le bouton.'}</p>
    {busy && <p role="status">On cherche votre film…</p>}{error && <ErrorMessage>{error}</ErrorMessage>}
    {wikidataError && <p className="hint" role="status">Wikidata indisponible, résultats OMDb</p>}
    {results && <div aria-live="polite">{results.length ? <><p className="eyebrow">Choisissez votre film</p><ul className="candidate-list">{results.map(raw => {
      const candidate = normalizeCandidate(raw);
      const titles = [...new Set([candidate.originalTitle, candidate.englishTitle].filter((title): title is string => Boolean(title)))].join(' / ');
      return <li key={candidate.imdbID}><button type="button" disabled={disabled || busy} onClick={() => onSelect(candidateSelection(raw, submitted))}><Poster title={candidate.title} src={candidate.poster} /><span><strong>{candidate.title}</strong><small>{[titles, candidate.year ?? 'Année inconnue', candidate.directors.join(', ')].filter(Boolean).join(' · ')}</small></span><Icon name="plus" /></button></li>;
    })}</ul></> : <Empty title="Pas de résultat."><p>Essayez le titre original ou passez à la saisie manuelle.</p></Empty>}<button type="button" className="text-button" disabled={disabled || busy} onClick={() => void search(submitted || query, 'omdb')}>Chercher sur OMDb</button></div>}
  </div>;
}
