import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Link } from 'react-router';
import type { BlindFilm, RerateNext, RerateReveal, Viewer } from '../types.ts';
import { api, json, message, useResource } from '../api.ts';
import { date, number } from '../format.ts';
import { displayTitles } from '../titles.ts';
import { parseRerateExclusions, rerateCount, rerateDelta, rerateSynopsisOverflows } from '../rerate.ts';
import { Empty, ErrorMessage, Loading } from '../components/Feedback.tsx';
import { Poster } from '../components/Poster.tsx';
import { RatingInput } from '../components/RatingInput.tsx';

const exclusionKey = 'filmsvus-rerate-exclude';

function Synopsis({ text }: { text: string }) {
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = paragraph.current;
    if (!element) return;
    const measure = () => setOverflows(rerateSynopsisOverflows(element.scrollHeight, parseFloat(getComputedStyle(element).lineHeight)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [text]);

  return <section className="prose-section"><h3>Synopsis</h3>
    <p id={id} ref={paragraph} className={`preserve-lines rerate-synopsis${expanded && overflows ? '' : ' is-collapsed'}`}>{text}</p>
    {overflows && <button className="text-button" type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? 'Réduire' : 'Lire la suite'}</button>}
  </section>;
}

function BlindSheet({ film, heading }: { film: BlindFilm; heading: RefObject<HTMLHeadingElement | null> }) {
  const titles = displayTitles(film);
  const director = film.credits.filter(c => c.role === 'director').map(c => c.name).join(', ') || film.director_text;
  const actors = film.credits.filter(c => c.role === 'actor').slice(0, 6).map(c => c.name).join(', ');
  const external = [
    { label: 'IMDb', value: film.imdb_rating, unit: '/10' },
    { label: 'Metascore', value: film.metascore, unit: '/100' },
    { label: 'Rotten Tomatoes', value: film.rt_score, unit: '%' },
  ].filter(score => score.value !== null);
  return <>
    <div className="detail-poster"><Poster title={titles.main} src={film.poster_url} priority /></div>
    <div className="detail-main"><header className="detail-heading">
      <p className="eyebrow">Vu le {date(film.watched_at)}</p>
      <h2 className="rerate-film-title" tabIndex={-1} ref={heading}>{titles.main}</h2>
      {titles.secondary && <p className="secondary-title">{titles.secondary}</p>}
      {director && <p className="detail-director">{director}</p>}
      <p className="film-facts">{[film.year, film.runtime_min ? `${film.runtime_min} min` : null, ...film.genres, ...film.countries].filter(Boolean).join(' · ')}</p>
    </header>
    {actors && <p className="hint">Avec {actors}</p>}
    <Synopsis key={film.id} text={film.plot_fr || film.plot_en || 'Aucun synopsis disponible pour ce film.'} />
    {external.length > 0 && <div className="external-scores" aria-label="Les notes de la presse et du public">{external.map(score => <div key={score.label}><span>{score.label}</span><b>{number(score.value)}<small>{score.unit}</small></b></div>)}</div>}
    </div>
  </>;
}

export function ReratePage() {
  const [exclude, setExclude] = useState<number[]>(() => {
    try { return parseRerateExclusions(sessionStorage.getItem(exclusionKey)); } catch { return []; }
  });
  const next = useResource<RerateNext>(`/rerate/next${exclude.length ? `?exclude=${exclude.join(',')}` : ''}`);
  const viewers = useResource<Viewer[]>('/viewers');
  const [scores, setScores] = useState<Record<number, number | null>>({});
  const [reveal, setReveal] = useState<RerateReveal | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const filmHeading = useRef<HTMLHeadingElement>(null), revealHeading = useRef<HTMLHeadingElement>(null);
  const emptyHeading = useRef<HTMLDivElement>(null);
  const film = next.data?.film;
  const core = viewers.data?.filter(v => v.is_core) ?? [];
  const complete = core.length === 2 && core.every(v => scores[v.id] != null);

  useEffect(() => {
    try { sessionStorage.setItem(exclusionKey, JSON.stringify(exclude)); } catch { /* Storage is optional. */ }
  }, [exclude]);
  useEffect(() => {
    if (next.loading) return;
    if (reveal) revealHeading.current?.focus();
    else if (film) filmHeading.current?.focus();
    else emptyHeading.current?.focus();
  }, [next.data, next.loading, reveal]);

  function advance() {
    setReveal(null); setScores({}); setError(''); next.reload();
  }
  function later() {
    if (!film) return;
    setScores({}); setError('');
    setExclude(ids => [...new Set([...ids, film.id])].slice(-500));
  }
  async function submit() {
    if (!film || !complete || busy) return;
    setBusy(true); setError('');
    try { setReveal(await api<RerateReveal>(`/rerate/${film.id}`, json('POST', { scores }))); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  async function ignore() {
    if (!film || busy) return;
    setBusy(true); setError('');
    try { await api(`/rerate/${film.id}/ignore`, json('POST')); advance(); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }

  return <div className="rerate-page">
    <header className="page-heading"><p className="eyebrow">Deux ans après, qu’en reste-t-il ?</p><h1>Renoter</h1>
      <p className="lead">Retrouvez les notes que vous pensez avoir données. Les notes d’origine se dévoileront ensuite.</p>
      {next.data && <p className="rerate-counter" role="status">{rerateCount(Math.max(0, next.data.remaining - (reveal ? 1 : 0)))}</p>}
    </header>
    {next.loading && <Loading />}
    {next.error && <ErrorMessage retry={next.reload}>{next.error}</ErrorMessage>}
    {error && <ErrorMessage action={<button type="button" disabled={busy} onClick={advance}>Actualiser la file</button>}>{error}</ErrorMessage>}
    {next.data && !film && <div tabIndex={-1} ref={emptyHeading}>
      <Empty title={next.data.remaining === 0 ? 'Tous les souvenirs ont eu leur séance.' : 'On garde la suite pour plus tard.'}>
        <p>{next.data.remaining === 0 ? 'Aucun film à renoter pour le moment. Revenez quand d’autres séances auront deux ans !' : 'Vous avez parcouru tous les films disponibles pour cette session.'}</p>
        {exclude.length > 0 && next.data.remaining > 0 && <button type="button" onClick={() => setExclude([])}>Revoir les films remis à plus tard</button>}
        <Link className="text-link" to="/">Retour à la collection</Link>
      </Empty>
    </div>}
    {film && <article className="film-detail" key={film.id}>
      <div className="detail-top"><BlindSheet film={film} heading={filmHeading} />
      {reveal ? <section className="surface rerate-panel rerate-reveal" aria-labelledby="reveal-title">
        <p className="eyebrow">Les souvenirs face aux notes</p><h2 id="reveal-title" tabIndex={-1} ref={revealHeading}>Le verdict de la mémoire</h2>
        <div className="rerate-comparisons">{reveal.scores.map(score => <div className="rerate-comparison" key={score.viewer_id}>
          <h3>{score.name}</h3><dl><div><dt>De mémoire</dt><dd>{score.score}<small>/10</small></dd></div>
          <div><dt>À l’époque</dt><dd>{number(score.original)}{score.original !== null && <small>/10</small>}</dd></div>
          <div><dt>Différence</dt><dd className="rerate-delta">{rerateDelta(score.delta)}</dd></div></dl>
        </div>)}</div>
        <p className="hint">Les notes d’origine sont conservées. Cette renote reste un souvenir, sans effet sur les statistiques.</p>
        <div className="form-actions"><Link className="text-link" to={`/film/${film.id}`}>Voir la fiche</Link><button className="primary" type="button" onClick={advance}>Film suivant</button></div>
      </section> : <section className="surface rerate-panel" aria-labelledby="remember-title">
        <h2 id="remember-title">Quelles notes aviez-vous données ?</h2>
        {viewers.loading && <Loading />}{viewers.error && <ErrorMessage retry={viewers.reload}>{viewers.error}</ErrorMessage>}
        <form onSubmit={event => { event.preventDefault(); void submit(); }}>
          <fieldset disabled={busy}>
            <div className="rating-inputs rerate-inputs">{core.map(viewer => <RatingInput key={`${film.id}-${viewer.id}`} label={viewer.name} value={scores[viewer.id] ?? null} onChange={score => setScores(previous => ({ ...previous, [viewer.id]: score }))} />)}</div>
            <div className="form-actions"><button className="primary" type="submit" disabled={!complete}>{busy ? 'Un instant…' : 'Valider'}</button></div>
            <div className="rerate-secondary"><button type="button" onClick={() => void ignore()}>Ignorer</button><button type="button" onClick={later}>Plus tard</button></div>
            <p className="hint">Ignorer retire ce film de la file. « Plus tard » le met de côté pour cette session.</p>
          </fieldset>
        </form>
      </section>}
      </div>
    </article>}
  </div>;
}
