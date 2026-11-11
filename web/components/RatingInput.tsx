import { useId, useState } from 'react';
import { number } from '../format.ts';

export function RatingInput({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string>();
  const step = (direction: number) => { setDraft(undefined); onChange(Math.max(-10, Math.min(10, Math.round(((value ?? 0) + direction * .5) * 2) / 2))); };
  return <fieldset className="rating-input"><legend>{label}</legend>
    <div className="stepper"><button type="button" aria-label={`Baisser la note de ${label}`} disabled={value === -10} onClick={() => step(-1)}>−</button>
      <div><label className="sr-only" htmlFor={id}>Note de {label} sur 10, de −10 à 10</label><input id={id} type="number" min="-10" max="10" step="0.5" placeholder="—" value={draft ?? value ?? ''}
        onChange={event => { const raw = event.target.value; setDraft(raw); if (!raw) onChange(null); else if (event.target.validity.valid) onChange(Number(raw)); }}
        onBlur={() => setDraft(undefined)} /><span>/10</span></div>
      <button type="button" aria-label={`Augmenter la note de ${label}`} disabled={value === 10} onClick={() => step(1)}>+</button></div>
    <button className="text-button unrated-button" type="button" aria-pressed={value === null} onClick={() => { setDraft(undefined); onChange(null); }}>{value === null ? 'Pas noté' : `Effacer la note (${number(value)})`}</button>
  </fieldset>;
}
