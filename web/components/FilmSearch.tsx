import { useEffect, useState } from 'react';
import type { Candidate, SearchResponse } from '../types.ts';
import { api, message } from '../api.ts';
import { Poster } from './Poster.tsx';
import { Icon } from './Icon.tsx';
import { Empty, ErrorMessage } from './Feedback.tsx';

export function FilmSearch({ initialQuery = '', initialResults, onSelect, disabled = false }: { initialQuery?: string; initialResults?: Candidate[]; onSelect: (candidate: Candidate) => void; disabled?: boolean }) {
  const [query, setQuery] = useState(initialQuery), [results, setResults] = useState<Candidate[] | undefined>(initialResults);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => setResults(initialResults), [initialResults]);
  async function search() {
    if (!query.trim()) return;
    setBusy(true); setError(''); setResults(undefined);
    try {
      const response = await api<SearchResponse>(`/search?q=${encodeURIComponent(query.trim())}`);
      setResults(response.Search ?? []);
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <div className="film-search"><form className="search-form" onSubmit={event => { event.preventDefault(); void search(); }}>
    <label>Le titre du film<span className="search-field"><Icon name="search" /><input type="search" maxLength={200} value={query} onChange={e => setQuery(e.target.value)} placeholder="Quel film avez-vous vu ?" required disabled={disabled || busy} /></span></label><button type="submit" className="primary" disabled={disabled || busy || !query.trim()}>{busy ? 'Recherche…' : 'Rechercher'}</button>
  </form><p className="hint">La recherche se lance uniquement avec le bouton.</p>
    {busy && <p role="status">On cherche votre film…</p>}{error && <ErrorMessage>{error}</ErrorMessage>}
    {results && <div aria-live="polite">{results.length ? <><p className="eyebrow">Choisissez votre film</p><ul className="candidate-list">{results.map(candidate => <li key={candidate.imdbID}><button type="button" disabled={disabled || busy} onClick={() => onSelect(candidate)}><Poster title={candidate.Title} src={candidate.Poster} /><span><strong>{candidate.Title}</strong><small>{candidate.Year || 'Année inconnue'} · {candidate.imdbID}</small></span><Icon name="plus" /></button></li>)}</ul></> : <Empty title="Pas de résultat."><p>Essayez le titre original ou passez à la saisie manuelle.</p></Empty>}</div>}
  </div>;
}
