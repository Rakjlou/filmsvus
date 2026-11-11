import { useState } from 'react';
import type { Tag } from '../types.ts';
import { api, json, message, useResource } from '../api.ts';
import { ErrorMessage } from './Feedback.tsx';
import { Icon } from './Icon.tsx';

export function TagPicker({ value, onChange, disabled = false }: { value: number[]; onChange: (ids: number[]) => void; disabled?: boolean }) {
  const tags = useResource<Tag[]>('/tags');
  const [creating, setCreating] = useState(false), [label, setLabel] = useState(''), [emoji, setEmoji] = useState('🎬');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function create() {
    if (!label.trim()) return;
    setBusy(true); setError('');
    try {
      const tag = await api<Tag>('/tags', json('POST', { label: label.trim(), emoji: emoji.trim() || null }));
      tags.setData([...(tags.data ?? []), tag]); onChange([...value, tag.id]); setCreating(false); setLabel('');
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <fieldset className="tag-picker" disabled={disabled || busy}><legend>Les petits détails</legend><p className="hint">Des souvenirs de séance, sans effet sur les notes.</p>
    <div className="chips">{tags.data?.map(tag => <button key={tag.id} type="button" className={`chip ${value.includes(tag.id) ? 'selected' : ''}`} aria-pressed={value.includes(tag.id)} onClick={() => onChange(value.includes(tag.id) ? value.filter(id => id !== tag.id) : [...value, tag.id])}>{tag.emoji} {tag.label}{value.includes(tag.id) && <Icon name="check" />}</button>)}
      <button className="chip" type="button" aria-expanded={creating} onClick={() => setCreating(!creating)}><Icon name="plus" /> Nouveau tag</button></div>
    {tags.loading && <p role="status">Chargement des tags…</p>}
    {tags.error && <ErrorMessage retry={tags.reload}>{tags.error}</ErrorMessage>}
    {creating && <div className="tag-create"><label>Emoji<input aria-label="Emoji du nouveau tag" maxLength={32} value={emoji} onChange={e => setEmoji(e.target.value)} /></label><label>Nom du tag<input maxLength={100} value={label} onChange={e => setLabel(e.target.value)} placeholder="On a adoré" /></label><button type="button" disabled={!label.trim()} onClick={() => void create()}>{busy ? 'Création…' : 'Créer'}</button></div>}
    {error && <ErrorMessage>{error}</ErrorMessage>}
  </fieldset>;
}
