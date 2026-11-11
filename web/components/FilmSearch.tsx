import { useEffect, useId, useRef, useState } from 'react';
import type { Candidate, SearchResponse } from '../types.ts';
import { api, message } from '../api.ts';
import { Poster } from './Poster.tsx';
import { Icon } from './Icon.tsx';
import { Empty, ErrorMessage } from './Feedback.tsx';

export function FilmSearch({ initialQuery = '', initialResults, onSelect, disabled = false }: { initialQuery?: string; initialResults?: Candidate[]; onSelect: (candidate: Candidate) => void; disabled?: boolean }) {
  const [query, setQuery] = useState(initialQuery), [results, setResults] = useState<Candidate[] | undefined>(initialResults);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [validation, setValidation] = useState('');
  const hintId = useId(), input = useRef<HTMLInputElement>(null);
  useEffect(() => setResults(initialResults), [initialResults]);
  async function search(submittedQuery: string) {
    if (disabled || busy) return;
    const title = submittedQuery.trim();
    if (!title) { setValidation('Saisissez un titre pour rechercher un film.'); input.current?.focus(); return; }
    setValidation('');
    setBusy(true); setError(''); setResults(undefined);
    try {
      const response = await api<SearchResponse>(`/search?q=${encodeURIComponent(title)}`);
      setResults(response.Search ?? []);
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <div className="film-search"><form className="search-form" onSubmit={event => { event.preventDefault(); void search(String(new FormData(event.currentTarget).get('q') ?? '')); }}>
    <label>Le titre du film<span className="search-field"><Icon name="search" /><input ref={input} name="q" type="search" maxLength={200} value={query} onChange={e => { setQuery(e.target.value); setValidation(''); }} placeholder="Quel film avez-vous vu ?" aria-invalid={Boolean(validation)} aria-describedby={hintId} disabled={disabled || busy} /></span></label><button type="submit" className="primary" disabled={disabled || busy}>{busy ? 'Recherche…' : 'Rechercher'}</button>
  </form><p id={hintId} className="hint" role={validation ? 'alert' : undefined}>{validation || 'La recherche se lance uniquement avec le bouton.'}</p>
    {busy && <p role="status">On cherche votre film…</p>}{error && <ErrorMessage>{error}</ErrorMessage>}
    {results && <div aria-live="polite">{results.length ? <><p className="eyebrow">Choisissez votre film</p><ul className="candidate-list">{results.map(candidate => <li key={candidate.imdbID}><button type="button" disabled={disabled || busy} onClick={() => onSelect(candidate)}><Poster title={candidate.Title} src={candidate.Poster} /><span><strong>{candidate.Title}</strong><small>{candidate.Year || 'Année inconnue'} · {candidate.imdbID}</small></span><Icon name="plus" /></button></li>)}</ul></> : <Empty title="Pas de résultat."><p>Essayez le titre original ou passez à la saisie manuelle.</p></Empty>}</div>}
  </div>;
}
