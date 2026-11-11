import { useState } from 'react';
import type { Film, FilmInput, Viewer } from '../types.ts';
import { localDateTime } from '../format.ts';
import { api, json, message } from '../api.ts';
import { RatingInput } from './RatingInput.tsx';
import { TagPicker } from './TagPicker.tsx';
import { ErrorMessage } from './Feedback.tsx';

export function FilmForm({ film, viewers, onSaved, onCancel, imdb = null }: { film?: Partial<Film>; viewers: Viewer[]; onSaved: (film: Film) => void; onCancel?: () => void; imdb?: string | null }) {
  const [title, setTitle] = useState(film?.title ?? ''), [director, setDirector] = useState(film?.director_text ?? '');
  const [titleFr, setTitleFr] = useState(film?.title_fr ?? ''), [originalTitle, setOriginalTitle] = useState(film?.original_title ?? '');
  const [year, setYear] = useState(film?.year?.toString() ?? ''), [watchedAt, setWatchedAt] = useState(localDateTime(film?.watched_at));
  const [summary, setSummary] = useState(film?.summary ?? film?.plot_en ?? ''), [comment, setComment] = useState(film?.comment ?? '');
  const [letterboxd, setLetterboxd] = useState(film?.letterboxd_url ?? '');
  const [tags, setTags] = useState(film?.tags?.map(t => t.id) ?? []);
  const [ratings, setRatings] = useState<Record<number, number | null>>(() => Object.fromEntries(viewers.map(v => [v.id, film?.ratings?.find(r => r.id === v.id)?.score ?? null])));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    const payload: FilmInput = { title: title.trim(), title_fr: titleFr.trim() || null, original_title: originalTitle.trim() || null,
      director_text: director.trim() || null, watched_at: new Date(watchedAt).toISOString(), year: year ? Number(year) : null,
      summary: summary.trim() || null, comment: comment.trim() || null, letterboxd_url: letterboxd.trim() || null,
      tag_ids: tags, ratings: viewers.filter(v => v.is_core || film?.id).map(v => ({ viewer_id: v.id, score: ratings[v.id] ?? null })),
      ...(imdb ? { imdb_id: imdb } : {}) };
    try { onSaved(await api<Film>(film?.id ? `/films/${film.id}` : '/films', json(film?.id ? 'PATCH' : 'POST', payload))); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <form className="film-form" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy} className="form-body">
    <label>Titre<input value={title} maxLength={500} required onChange={e => setTitle(e.target.value)} /></label>
    {film?.id && <div className="form-pair"><label>Titre français<input value={titleFr} onChange={e => setTitleFr(e.target.value)} /></label><label>Titre original<input value={originalTitle} onChange={e => setOriginalTitle(e.target.value)} /></label></div>}
    <div className="form-pair"><label>Réalisation<input value={director} onChange={e => setDirector(e.target.value)} placeholder="Nom du ou de la cinéaste" /></label><label>Année de sortie<input type="number" min="1800" max="2200" step="1" value={year} onChange={e => setYear(e.target.value)} placeholder="Facultatif" /></label></div>
    <label>Date et heure du visionnage<input type="datetime-local" required value={watchedAt} onChange={e => setWatchedAt(e.target.value)} /><span className="hint">Heure locale de cet appareil.</span></label>
    <section className="ratings-edit" aria-label="Vos notes"><div className="section-label"><span className="eyebrow">Deux regards sur le film</span><p className="hint">De −10 à 10, par demi-point. Tous les avis comptent.</p></div><div className="rating-inputs">{viewers.filter(v => v.is_core || film?.id).map(viewer => <RatingInput key={viewer.id} label={viewer.name} value={ratings[viewer.id] ?? null} onChange={value => setRatings(previous => ({ ...previous, [viewer.id]: value }))} />)}</div></section>
    <TagPicker value={tags} onChange={setTags} />
    <label>Commentaire<textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="Ce qu’on en garde, à chaud ou longtemps après…" /></label>
    <label>Résumé<textarea value={summary} onChange={e => setSummary(e.target.value)} rows={4} placeholder="L’histoire, en quelques mots" /><span className="hint">Si vous le laissez vide, le synopsis sera affiché après l’enrichissement.</span></label>
    <label>Lien Letterboxd<input type="url" value={letterboxd} onChange={e => setLetterboxd(e.target.value)} placeholder="https://letterboxd.com/…" /></label>
    <div className="form-actions">{onCancel && <button type="button" onClick={onCancel}>Annuler</button>}<button className="primary" type="submit" disabled={!title.trim()}>{busy ? 'Enregistrement…' : film?.id ? 'Enregistrer les modifications' : 'Garder cette séance'}</button></div>
  </fieldset>{error && <ErrorMessage>{error}</ErrorMessage>}</form>;
}
