import { useEffect, useRef } from 'react';
import type { Film } from '../types.ts';
import { directorNames, filterKeys } from '../listState.ts';
import { watchedYear } from '../format.ts';
import { Icon } from './Icon.tsx';
import { useUrlBackedText } from '../useUrlBackedText.ts';

export function FilterSheet({ films, params, update, close, count }: { films: Film[]; params: URLSearchParams; update: (next: URLSearchParams) => void; close: () => void; count: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  const set = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); update(next); };
  const [min, setMin] = useUrlBackedText(params.get('min') ?? '', value => set('min', value));
  const [max, setMax] = useUrlBackedText(params.get('max') ?? '', value => set('max', value));
  const [gap, setGap] = useUrlBackedText(params.get('gap') ?? '', value => set('gap', value));
  const unique = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  const tags = [...new Map(films.flatMap(f => f.tags).map(tag => [tag.id, tag])).values()];
  return <dialog className="filter-dialog" ref={dialog} aria-labelledby="filter-title" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="sheet-content"><div className="sheet-header"><div><span className="eyebrow">À votre envie</span><h2 id="filter-title">Affiner la séance</h2></div><button type="button" className="icon-button" aria-label="Fermer les filtres" onClick={close}><Icon name="close" /></button></div>
      <div className="sheet-fields">
        <fieldset><legend>Tags</legend><div className="chips">{tags.length ? tags.map(tag => <button key={tag.id} type="button" className={`chip ${params.getAll('tag').includes(String(tag.id)) ? 'selected' : ''}`} aria-pressed={params.getAll('tag').includes(String(tag.id))} onClick={() => { const next = new URLSearchParams(params), values = next.getAll('tag'); next.delete('tag'); (values.includes(String(tag.id)) ? values.filter(id => id !== String(tag.id)) : [...values, String(tag.id)]).forEach(id => next.append('tag', id)); update(next); }}>{tag.emoji} {tag.label}</button>) : <p className="hint">Aucun tag dans la collection.</p>}</div></fieldset>
        <label>Genre<select value={params.get('genre') ?? ''} onChange={e => set('genre', e.target.value)}><option value="">Tous les genres</option>{unique(films.flatMap(f => f.genres)).map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Réalisation<select value={params.get('director') ?? ''} onChange={e => set('director', e.target.value)}><option value="">Tous les cinéastes</option>{unique(films.flatMap(directorNames)).map(value => <option key={value}>{value}</option>)}</select></label>
        <div className="form-pair"><label>Année de visionnage<select value={params.get('year') ?? ''} onChange={e => set('year', e.target.value)}><option value="">Toutes</option>{unique(films.map(f => watchedYear(f.watched_at))).reverse().map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Décennie de sortie<select value={params.get('decade') ?? ''} onChange={e => set('decade', e.target.value)}><option value="">Toutes</option>{unique(films.flatMap(f => f.year === null ? [] : [String(Math.floor(f.year / 10) * 10)])).map(value => <option key={value} value={value}>{value}–{Number(value) + 9}</option>)}</select></label></div>
        <fieldset><legend>Note moyenne /10</legend><div className="form-pair"><label>Minimum<input type="number" min="0" max="10" step="0.5" placeholder="0" value={min} onChange={e => setMin(e.target.value)} /></label><label>Maximum<input type="number" min="0" max="10" step="0.5" placeholder="10" value={max} onChange={e => setMax(e.target.value)} /></label></div></fieldset>
        <label>Désaccord minimum<input type="number" min="0" max="10" step="1" placeholder="Écart entre Fleur et Noé" value={gap} onChange={e => setGap(e.target.value)} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={params.get('unrated') === '1'} onChange={e => set('unrated', e.target.checked ? '1' : '')} /> Aucune note du couple</label>
        <label className="checkbox-label"><input type="checkbox" checked={params.get('unhydrated') === '1'} onChange={e => set('unhydrated', e.target.checked ? '1' : '')} /> Pas encore enrichi</label>
      </div><div className="sheet-footer"><button className="text-button" type="button" onClick={() => { const next = new URLSearchParams(params); filterKeys.forEach(key => next.delete(key)); update(next); }}>Réinitialiser</button><button className="primary" type="button" onClick={close}>Voir {count} film{count > 1 ? 's' : ''}</button></div>
    </div></dialog>;
}
