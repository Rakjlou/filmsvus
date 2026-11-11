import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Film } from '../types.ts';
import { useResource } from '../api.ts';
import { filterKeys, selectFilms, sorts } from '../listState.ts';
import { FilmCard, FilmRow } from '../components/FilmCard.tsx';
import { FilterSheet } from '../components/FilterSheet.tsx';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorMessage, Loading } from '../components/Feedback.tsx';

export function ListPage() {
  const { data: films, error, loading, reload } = useResource<Film[]>('/films');
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const results = useMemo(() => selectFilms(films ?? [], params), [films, params]);
  const set = (key: string, value: string) => { setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true }); };
  const filterCount = filterKeys.reduce((count, key) => count + params.getAll(key).filter(Boolean).length, 0);
  const rows = params.get('view') === 'rows';
  const returnTo = `/${params.size ? `?${params.toString()}` : ''}`;
  return <>
    <header className="page-heading list-heading"><div><p className="eyebrow"><span className="live-dot" /> Notre carnet de cinéma</p><h1>Après le <em>générique.</em></h1><p className="lead">Les films passent. Les souvenirs restent.</p></div><span className="collection-stamp" aria-hidden="true">F & N<span>DEPUIS 2018</span></span></header>
    <section className="collection" aria-label="Collection de films">
      <div className="toolbar"><label className="search-field"><Icon name="search" /><span className="sr-only">Rechercher dans la collection</span><input type="search" placeholder="Un titre, un cinéaste, un souvenir…" value={params.get('q') ?? ''} onChange={e => set('q', e.target.value)} /></label>
        <div className="sort-controls"><label className="sort-select"><span className="sr-only">Trier par</span><select value={sorts.some(([key]) => key === params.get('sort')) ? params.get('sort')! : 'watched_at'} onChange={e => set('sort', e.target.value)}>{sorts.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="icon-button sort-direction" type="button" aria-label={params.get('dir') === 'asc' ? 'Ordre croissant, passer en décroissant' : 'Ordre décroissant, passer en croissant'} onClick={() => set('dir', params.get('dir') === 'asc' ? 'desc' : 'asc')}><Icon name="arrow" className={params.get('dir') === 'asc' ? 'rotate' : ''} /></button></div>
        <button className={`filter-button ${filterCount ? 'active' : ''}`} type="button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog"><Icon name="filter" /> Filtres{filterCount > 0 && <span className="count-badge">{filterCount}</span>}</button>
      </div>
      <div className="collection-subbar"><p role="status">{loading ? 'La collection se prépare…' : <><strong>{results.length}</strong> film{results.length > 1 ? 's' : ''}{(filterCount > 0 || params.get('q')) && ` sur ${films?.length ?? 0}`}</>}</p><div className="view-toggle" aria-label="Affichage"><button className={!rows ? 'selected' : ''} type="button" aria-label="Vue affiches" aria-pressed={!rows} onClick={() => set('view', 'grid')}><Icon name="grid" /></button><button className={rows ? 'selected' : ''} type="button" aria-label="Vue compacte" aria-pressed={rows} onClick={() => set('view', 'rows')}><Icon name="rows" /></button></div></div>
      {error && <ErrorMessage retry={reload}>{error}</ErrorMessage>}
      {loading && <Loading />}
      {!loading && !error && (results.length ? rows ? <ul className="film-rows">{results.map(film => <FilmRow key={film.id} film={film} returnTo={returnTo} />)}</ul> : <div className="film-grid">{results.map(film => <FilmCard key={film.id} film={film} returnTo={returnTo} />)}</div>
        : <Empty title={films?.length ? 'Aucun film dans ce cadre.' : 'La première séance vous attend.'}>{films?.length ? <button type="button" onClick={() => setParams({})}>Effacer la recherche et les filtres</button> : <><p>Un film, deux regards. Commencez votre collection.</p><Link className="button primary" to="/ajouter"><Icon name="plus" /> Ajouter un film</Link></>}</Empty>)}
    </section>
    {filtersOpen && <FilterSheet films={films ?? []} params={params} update={next => setParams(next, { replace: true })} close={() => setFiltersOpen(false)} count={results.length} />}
  </>;
}
