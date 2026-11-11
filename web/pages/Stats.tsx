import { useState } from 'react';
import { Link } from 'react-router';
import type { Stats } from '../types.ts';
import { useResource } from '../api.ts';
import { number } from '../format.ts';
import { Score } from '../components/FilmCard.tsx';
import { Empty, ErrorMessage, Loading } from '../components/Feedback.tsx';
import { BarChart, ScatterChart } from '../components/Charts.tsx';

type Rank = Stats['top'];
function Ranking({ title, films, gap = false }: { title: string; films: Rank; gap?: boolean }) {
  return <section className="surface ranking"><h2>{title}</h2>{films.length ? <ol>{films.slice(0, 5).map((film, index) => <li key={film.id}><Link to={`/film/${film.id}`}><span className="rank-position">{String(index + 1).padStart(2, '0')}</span><span className="rank-title">{film.title}</span>{gap ? <span className="gap-value">{number(film.gap)}<small> pts</small></span> : <Score value={film.avg} small />}</Link></li>)}</ol> : <p className="hint">Les premières notes écriront ce classement.</p>}</section>;
}
export function StatsPage() {
  const resource = useResource<Stats>('/stats');
  const stats = resource.data;
  const currentYear = new Intl.DateTimeFormat('fr-FR', { year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date());
  const [year, setYear] = useState(currentYear), [person, setPerson] = useState('couple');
  const selected = stats?.viewers.find(v => String(v.id) === person);
  const distribution = selected?.rating_distribution ?? stats?.rating_distribution ?? {};
  return <>
    <header className="page-heading"><p className="eyebrow">Le cinéma, à deux</p><h1>Nos séances, <em>en chiffres.</em></h1><p className="lead">Des habitudes, des coups de cœur et quelques désaccords.</p></header>
    {resource.loading && <Loading />}{resource.error && <ErrorMessage retry={resource.reload}>{resource.error}</ErrorMessage>}
    {stats && (!stats.total ? <Empty title="Le début d’une belle série."><p>Ajoutez votre première séance pour voir vos statistiques.</p><Link className="button primary" to="/ajouter">Ajouter un film</Link></Empty> : <>
      <div className="kpi-grid"><div className="kpi"><span>Films vus</span><strong>{number(stats.total, 0)}</strong><small>{stats.rated} avec une note du couple</small></div><div className="kpi"><span>Notre moyenne</span><strong><Score value={stats.avg} /></strong><small>Les notes du couple uniquement</small></div>{stats.viewers.map(v => <div className="kpi" key={v.id}><span>Moyenne {v.name}{!v.is_core && ' · invité'}</span><strong><Score value={v.avg} /></strong><small>{v.count} film{v.count > 1 ? 's' : ''} noté{v.count > 1 ? 's' : ''}</small></div>)}</div>
      <div className="stats-grid"><section className="surface"><div className="section-heading"><div><p className="eyebrow">Au fil du temps</p><h2>Une année après l’autre</h2></div></div><BarChart title="Films vus par année" data={Object.entries(stats.films_by_year).sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }))} /></section>
        <section className="surface"><div className="section-heading"><div><p className="eyebrow">Le rythme des séances</p><h2>Mois par mois</h2></div><label className="chart-select"><span className="sr-only">Année du graphique mensuel</span><select value={year} onChange={e => setYear(e.target.value)}>{[...new Set([currentYear, ...Object.keys(stats.films_by_year)])].sort().reverse().map(y => <option key={y}>{y}</option>)}</select></label></div><BarChart title={`Films vus par mois en ${year}`} data={Array.from({ length: 12 }, (_, i) => ({ label: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'][i]!, value: stats.films_by_month[`${year}-${String(i + 1).padStart(2, '0')}`] ?? 0 }))} /></section>
        <section className="surface distribution"><div className="section-heading"><div><p className="eyebrow">Sévères ou bon public ?</p><h2>La couleur de nos notes</h2></div><label className="chart-select"><span className="sr-only">Distribution des notes de</span><select value={person} onChange={e => setPerson(e.target.value)}><option value="couple">Le couple</option>{stats.viewers.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label></div><p className="hint">Notes regroupées par point entier inférieur, y compris les notes négatives.</p><BarChart title={`Distribution des notes : ${selected?.name ?? 'couple'}`} data={Array.from({ length: 21 }, (_, i) => ({ label: String(i - 10), value: distribution[String(i - 10)] ?? 0 }))} /></section>
      </div>
      <div className="rankings-grid"><Ranking title="Nos coups de cœur" films={stats.top} /><Ranking title="On passe notre tour" films={stats.flop} /><Ranking title="On n’a pas vu le même film" films={stats.disagreements} gap /></div>
      <div className="stats-grid"><section className="surface"><p className="eyebrow">Les habitués du générique</p><h2>Nos cinéastes les plus vus</h2>{stats.directors.length ? <div className="aggregate-list">{stats.directors.slice(0, 10).map(d => <div key={d.name}><Link to={`/?director=${encodeURIComponent(d.name)}`}>{d.name}</Link><span>{d.count} film{d.count > 1 ? 's' : ''}</span><Score value={d.avg} small /></div>)}</div> : <p className="hint">Ajoutez les noms des cinéastes ou enrichissez vos films.</p>}</section>
        <section className="surface"><p className="eyebrow">Ce qui nous attire</p><h2>Nos genres de prédilection</h2>{stats.genres.length ? <div className="genre-list">{stats.genres.slice(0, 10).map(g => <Link key={g.name} to={`/?genre=${encodeURIComponent(g.name)}`}><span>{g.name}</span><span className="genre-track"><span style={{ width: `${g.count / Math.max(1, ...stats.genres.map(g => g.count)) * 100}%` }} /></span><b>{g.count}</b></Link>)}</div> : <p className="hint">Les genres apparaîtront avec les films enrichis.</p>}</section>
        <section className="surface"><p className="eyebrow">Voyage dans le temps</p><h2>Décennies de sortie</h2>{stats.decades.length ? <BarChart title="Films par décennie de sortie" data={[...stats.decades].sort((a, b) => Number(a.name) - Number(b.name)).map(d => ({ label: d.name, value: d.count }))} /> : <p className="hint">Les décennies apparaîtront avec les films enrichis.</p>}</section>
        <section className="surface"><p className="eyebrow">Notre regard et le leur</p><h2>Est-on d’accord avec IMDb ?</h2>{stats.imdb_pairs.length >= 3 ? <><p className="hint">{stats.imdb_pairs.length} films comparés · corrélation {number(stats.imdb_correlation, 2)}</p><ScatterChart stats={stats} /></> : <p className="hint">Au moins 3 films avec une note du couple et une note IMDb permettront de comparer nos regards. Actuellement : {stats.imdb_pairs.length}.</p>}</section>
      </div>
      <section className="hydration-summary surface"><div><p className="eyebrow">La collection prend vie</p><h2>{number(stats.hydration_rate * 100, 0)} % de films enrichis</h2><p className="hint">{stats.hydrated} sur {stats.total} films ont leurs informations complètes.</p></div><div className="hydration-progress"><label htmlFor="hydration" className="sr-only">Taux d’enrichissement</label><progress id="hydration" max="1" value={stats.hydration_rate} /><Link className="text-link" to="/?unhydrated=1">Voir les films à enrichir →</Link></div></section>
    </>)}
  </>;
}
