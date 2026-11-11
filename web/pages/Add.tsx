import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Candidate, Film, Viewer } from '../types.ts';
import { useResource } from '../api.ts';
import { FilmSearch } from '../components/FilmSearch.tsx';
import { FilmForm } from '../components/FilmForm.tsx';
import { Poster } from '../components/Poster.tsx';
import { ErrorMessage, Loading } from '../components/Feedback.tsx';

export function AddPage() {
  const viewers = useResource<Viewer[]>('/viewers');
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Candidate>(), [manual, setManual] = useState(false), [imdbMode, setImdbMode] = useState(false);
  const [imdb, setImdb] = useState(''), [imdbValid, setImdbValid] = useState('');
  const editing = Boolean(selected || manual || imdbValid);
  const prefill: Partial<Film> | undefined = selected ? { title: selected.Title, year: /^\d{4}$/.test(selected.Year ?? '') ? Number(selected.Year) : null, summary: selected.Plot === 'N/A' ? null : selected.Plot ?? null, director_text: selected.Director ?? null } : undefined;
  return <div className="narrow-page"><header className="page-heading"><p className="eyebrow">Une séance de plus</p><h1>Qu’est-ce qu’on <em>a vu ?</em></h1><p className="lead">Trouvez le film. Gardez votre impression.</p></header>
    {viewers.loading && <Loading />}{viewers.error && <ErrorMessage retry={viewers.reload}>{viewers.error}</ErrorMessage>}
    {viewers.data && <>
      {!editing ? <section className="surface add-discovery" aria-label="Trouver le film"><FilmSearch onSelect={candidate => { setSelected(candidate); setImdbValid(candidate.imdbID); }} />
        <div className="alternative-actions"><button type="button" className="text-button" onClick={() => setImdbMode(!imdbMode)} aria-expanded={imdbMode}>Coller une URL IMDb</button><span>ou</span><button type="button" className="text-button" onClick={() => setManual(true)}>Saisie manuelle</button></div>
        {imdbMode && <form className="imdb-form" onSubmit={event => { event.preventDefault(); setImdbValid(imdb.trim()); }}><label>URL ou identifiant IMDb<input required value={imdb} onChange={e => setImdb(e.target.value)} placeholder="https://www.imdb.com/title/tt…" pattern="(tt[0-9]{7,10}|https?://(www\.)?imdb\.com/title/tt[0-9]{7,10}(/.*)?)" /></label><p className="hint">Renseignez ensuite le titre et vos notes. Les métadonnées seront enrichies après l’enregistrement.</p><button type="submit">Utiliser cet IMDb</button></form>}
      </section> : <section className="surface" aria-label="Votre séance">
        <div className="selected-film">{selected && <Poster title={selected.Title} src={selected.Poster} />}<div><p className="eyebrow">{selected ? 'À l’affiche ce soir' : imdbValid ? 'Film lié à IMDb' : 'Saisie manuelle'}</p><h2>{selected?.Title ?? 'Votre prochaine entrée'}</h2>{selected?.Year && <p className="muted">{selected.Year}</p>}<button type="button" className="text-button" onClick={() => { setSelected(undefined); setManual(false); setImdbValid(''); }}>Choisir un autre film</button></div></div>
        <FilmForm key={selected?.imdbID ?? imdbValid ?? 'manual'} film={prefill} imdb={imdbValid || null} viewers={viewers.data} onSaved={film => navigate(`/film/${film.id}`, { state: { added: true } })} />
      </section>}
    </>}
  </div>;
}
