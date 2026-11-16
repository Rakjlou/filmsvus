import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { Candidate, Film, Role, SearchResponse, Viewer } from '../types.ts';
import type { WikidataCandidate } from '../../server/services/wikidata.ts';
import { api, json, message, useResource } from '../api.ts';
import { date, number } from '../format.ts';
import { Poster } from '../components/Poster.tsx';
import { Score } from '../components/FilmCard.tsx';
import { FilmForm } from '../components/FilmForm.tsx';
import { FilmSearch } from '../components/FilmSearch.tsx';
import { displayTitles } from '../titles.ts';
import { ErrorMessage, Loading } from '../components/Feedback.tsx';
import { useAuth } from '../auth.tsx';
import { Icon } from '../components/Icon.tsx';

const roles: [Role, string][] = [['director', 'Réalisation'], ['writer', 'Scénario'], ['composer', 'Musique'], ['cinematographer', 'Image'], ['editor', 'Montage'], ['producer', 'Production'], ['actor', 'Casting']];
export function FilmPage() {
  const { id } = useParams();
  const { canEdit } = useAuth();
  const resource = useResource<Film>(`/films/${id}`);
  const viewers = useResource<Viewer[]>('/viewers');
  const navigate = useNavigate(), location = useLocation();
  const routeState = location.state as { returnTo?: string; added?: boolean } | null;
  const [editing, setEditing] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [imdb, setImdb] = useState(''), [candidates, setCandidates] = useState<Candidate[]>();
  const deleteButton = useRef<HTMLButtonElement>(null);
  const film = resource.data;
  const credits = film ? roles.map(([role, label]) => {
    const names = film.credits.filter(c => c.role === role).map(c => c.name.trim()).filter(Boolean);
    return { label, names: names.join(', ') || (role === 'director' ? film.director_text?.trim() : '') };
  }).filter(credit => credit.names) : [];
  const companies = film?.companies.map(c => c.name.trim()).filter(Boolean).join(', ');
  const externalScores = film ? [
    { label: 'IMDb', value: film.imdb_rating, unit: '/10' },
    { label: 'Metascore', value: film.metascore, unit: '/100' },
    { label: 'Rotten Tomatoes', value: film.rt_score, unit: '%' },
  ].filter(metric => metric.value !== null) : [];
  const hasExternalInfo = film && (externalScores.length > 0 || film.awards || film.box_office || film.languages.length > 0 || film.imdb_id);
  useEffect(() => { if (film) document.title = `${displayTitles(film).main} · Films vus`; }, [film]);
  useEffect(() => {
    if (!canEdit || !film?.needs_review || busy) return;
    const controller = new AbortController();
    const saved = film.wikidata_raw ? (JSON.parse(film.wikidata_raw) as { searchCandidates?: WikidataCandidate[] }).searchCandidates ?? [] : [];
    const stored: Candidate[] = saved.map(c => ({ imdbID: c.imdbID,
      title: c.titleFr ?? c.originalTitle ?? c.titleEn ?? c.imdbID, originalTitle: c.originalTitle,
      englishTitle: c.titleEn, year: c.year, directors: c.directors, poster: null, source: 'wikidata' }));
    setCandidates(stored.length ? stored : undefined);
    void api<SearchResponse>(`/search?q=${encodeURIComponent(film.title.slice(0, 200))}`, { signal: controller.signal }).then(response => {
      const found = response.Search ?? [];
      // Keep the batch's ranked suggestions visible, including titles with a year hint.
      setCandidates([...stored, ...found.filter(c => !stored.some(s => s.imdbID === c.imdbID))]);
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)); });
    return () => controller.abort();
  }, [film?.id, film?.title, film?.needs_review, film?.wikidata_raw, busy, canEdit]);
  // New entries are hydrated by the API. Poll only local data, never OMDb.
  useEffect(() => {
    if (!routeState?.added || !film || film.hydrated || film.needs_review || editing) return;
    const controller = new AbortController();
    let attempts = 0;
    const interval = window.setInterval(() => {
      if (++attempts >= 10) window.clearInterval(interval);
      void api<Film>(`/films/${id}`, { signal: controller.signal }).then(updated => {
        if (updated.hydrated || updated.needs_review) resource.setData(updated);
      }).catch(() => { window.clearInterval(interval); });
    }, 3000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [id, routeState?.added, film?.hydrated, film?.needs_review, Boolean(film), editing, resource.setData]);
  useEffect(() => { if (!canEdit) { setEditing(false); setConfirmDelete(false); } }, [canEdit]);
  async function hydrate(candidateId?: string) {
    if (!film) return;
    setBusy(true); setError(''); setNotice(''); setCandidates(undefined);
    try {
      if (candidateId) resource.setData(await api<Film>(`/films/${id}`, json('PATCH', { imdb_id: candidateId })));
      const updated = await api<Film>(`/films/${id}/hydrate`, json('POST'));
      resource.setData(updated);
      if (updated.needs_review) {
        setNotice('Plusieurs films peuvent correspondre. Choisissez le bon ci-dessous.');
      } else setNotice('Les informations du film sont à jour.');
    } catch (error) { setError(message(error)); resource.reload(); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await api(`/films/${id}`, json('DELETE')); navigate(routeState?.returnTo ?? '/', { replace: true }); }
    catch (error) { setError(message(error)); setBusy(false); }
  }
  return <>
    <Link className="back-link" to={routeState?.returnTo ?? '/'}><Icon name="back" /> Retour à la collection</Link>
    {resource.loading && <Loading />}{resource.error && <ErrorMessage retry={resource.reload}>{resource.error}</ErrorMessage>}
    {film && <article className="film-detail">
      <div className="detail-top"><div className="detail-poster"><Poster title={displayTitles(film).main} src={film.poster_url} priority /><span className="poster-undertext">Une séance de Fleur & Noé</span></div>
      <div className="detail-main"><header className="detail-heading"><p className="eyebrow">Vu le {date(film.watched_at)}</p><h1>{displayTitles(film).main}</h1>
        {displayTitles(film).secondary && <p className="secondary-title">{displayTitles(film).secondary}</p>}
        <p className="detail-director">{film.director_text || film.credits.filter(c => c.role === 'director').map(c => c.name).join(', ') || 'Réalisation à découvrir'}</p>
        <p className="film-facts">{[film.year, film.runtime_min ? `${film.runtime_min} min` : null, ...film.genres, ...film.countries].filter(Boolean).join(' · ') || (canEdit ? 'Les détails du film sont à enrichir.' : 'Les détails du film ne sont pas encore disponibles.')}</p>
      </header>
      {canEdit && <div className="detail-actions"><button type="button" disabled={busy} onClick={() => setEditing(!editing)} aria-expanded={editing}><Icon name="edit" /> {editing ? 'Fermer l’édition' : 'Modifier'}</button><button className="primary" type="button" disabled={busy || film.hydrated || editing} onClick={() => void hydrate()}><Icon name="sparkle" /> {busy ? 'Un instant…' : film.hydrated ? 'Film enrichi' : 'Enrichir'}</button></div>}
      {error && <ErrorMessage>{error}</ErrorMessage>}{notice && <p className="notice" role="status">{notice}</p>}
      {canEdit && routeState?.added && !notice && <p className="notice" role="status">{film.hydrated ? 'Séance enregistrée et film enrichi.' : film.needs_review ? 'Séance enregistrée. Vérifiez le film IMDb pour compléter les informations.' : 'Séance enregistrée. L’enrichissement se poursuit en arrière-plan.'}</p>}
      {editing ? <section className="surface edit-panel" aria-label="Modifier le film">{viewers.loading && <Loading />}{viewers.error && <ErrorMessage retry={viewers.reload}>{viewers.error}</ErrorMessage>}{viewers.data && <FilmForm film={film} viewers={viewers.data} onCancel={() => setEditing(false)} onSaved={updated => { resource.setData(updated); setEditing(false); setNotice('Vos modifications sont enregistrées.'); }} />}</section> : <>
        <section className="ratings-panel" aria-label="Les notes"><div className="couple-rating"><span className="eyebrow">Notre moyenne</span><Score value={film.avg} /><span className="hint">Fleur & Noé</span></div><div className="individual-ratings">{film.ratings.filter(r => r.is_core).map(r => <div key={r.id}><span>{r.name}</span><Score small value={r.score} /></div>)}<div className="derived-rating"><span>Écart F / N</span><span>{number(film.gap)} <small>pts</small></span></div></div></section>
        {film.tags.length > 0 && <section className="detail-tags"><h2>Souvenirs de séance</h2><div className="chips">{film.tags.map(tag => <span className="tag-label" key={tag.id}>{tag.emoji} {tag.label}</span>)}</div></section>}
        <section className="prose-section"><p className="eyebrow">L’histoire</p><h2>Synopsis</h2><p className="preserve-lines">{film.summary || film.plot_fr || film.plot_en || (canEdit ? 'Le résumé arrivera avec l’enrichissement. Vous pouvez aussi écrire le vôtre.' : 'Aucun synopsis pour le moment.')}</p>{!film.summary && (film.plot_fr ? <p className="hint">Synopsis issu de Wikipédia.</p> : film.plot_en && <p className="hint">Synopsis original, en anglais, fourni par OMDb.</p>)}</section>
        {(canEdit || film.comment) && <section className="prose-section comment-section"><p className="eyebrow">Après la séance</p><h2>Notre commentaire</h2><p className="preserve-lines">{film.comment || 'Pas encore de commentaire. Qu’est-ce qu’on en garde ?'}</p></section>}
      </>}
      {canEdit && <section className="enrichment-panel surface" aria-labelledby="enrichment-title"><div className="section-heading"><h2 id="enrichment-title">Le bon film, les bonnes infos</h2><span className={`status-pill ${film.hydrated ? 'complete' : ''}`}>{film.hydrated ? 'Enrichi' : film.needs_review ? 'À vérifier' : 'À enrichir'}</span></div>
        <form className="imdb-form" onSubmit={e => { e.preventDefault(); void hydrate(imdb.trim()); }}><label>Coller une URL IMDb<input value={imdb} onChange={e => setImdb(e.target.value)} placeholder={film.imdb_id ?? 'https://www.imdb.com/title/tt…'} disabled={busy || editing} required pattern="(tt[0-9]{7,10}|https?://(www\.)?imdb\.com/title/tt[0-9]{7,10}(/.*)?)" /></label><button type="submit" disabled={busy || editing || !imdb.trim()}>Lier et enrichir</button></form>
        {film.needs_review && !editing && <><p className="hint">Vérifiez le titre ou recherchez le titre original pour choisir la bonne affiche.</p><FilmSearch key={film.id} initialQuery={film.title} initialResults={candidates} onSelect={candidate => void hydrate(candidate.imdbID)} disabled={busy} /></>}
      </section>}
    </div>
    </div>
    <div className="detail-extras"><section className="surface"><p className="eyebrow">Derrière la caméra</p><h2>Le générique</h2>{credits.length > 0 || companies ? <dl className="credits-list">{credits.map(({ label, names }) => <div key={label}><dt>{label}</dt><dd>{names}</dd></div>)}{companies && <div><dt>Sociétés de production</dt><dd>{companies}</dd></div>}</dl> : <p className="hint">{canEdit ? 'Cliquez sur « Enrichir » pour découvrir le générique.' : 'Le générique n’est pas encore disponible.'}</p>}</section>
      {hasExternalInfo && <section className="surface"><p className="eyebrow">Les autres regards</p><h2>Au-delà de notre canapé</h2>{externalScores.length > 0 && <div className="external-scores">{externalScores.map(({ label, value, unit }) => <div key={label}><span>{label}</span><b>{number(value)}<small>{unit}</small></b></div>)}</div>}<dl className="credits-list">{film.awards && <div><dt>Récompenses</dt><dd>{film.awards}</dd></div>}{film.box_office && <div><dt>Box-office</dt><dd>{film.box_office}</dd></div>}{film.languages.length > 0 && <div><dt>Langues</dt><dd>{film.languages.join(', ')}</dd></div>}</dl>{(film.imdb_id) && <div className="external-links">{film.imdb_id && <a className="button" href={`https://www.imdb.com/title/${film.imdb_id}/`} target="_blank" rel="noopener noreferrer">IMDb <Icon name="external" /><span className="sr-only"> (nouvel onglet)</span></a>}</div>}</section>}
    </div>
    {canEdit && <div className="delete-area">{confirmDelete ? <section className="delete-confirm" aria-labelledby="delete-title"><h2 id="delete-title">Supprimer « {displayTitles(film).main} » ?</h2><p>Les notes, tags et souvenirs de cette séance seront supprimés.</p><div className="form-actions"><button type="button" autoFocus disabled={busy} onClick={() => { setConfirmDelete(false); window.requestAnimationFrame(() => deleteButton.current?.focus()); }}>Garder le film</button><button className="danger" type="button" disabled={busy} onClick={() => void remove()}>{busy ? 'Suppression…' : 'Supprimer définitivement'}</button></div></section> : <button ref={deleteButton} type="button" className="text-button danger-text" disabled={busy || editing} onClick={() => setConfirmDelete(true)}>Supprimer cette séance</button>}</div>}
    </article>}
  </>;
}
