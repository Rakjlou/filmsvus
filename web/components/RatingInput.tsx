import { useId, useState } from 'react';
import { number } from '../format.ts';
import { stepRating } from '../rating.ts';

export function RatingInput({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string>();
  const step = (direction: -1 | 1) => { setDraft(undefined); onChange(stepRating(value, direction)); };
  return <fieldset className="rating-input"><legend>{label}</legend>
    <div className="stepper"><button type="button" aria-label={`Baisser la note de ${label}`} disabled={value === 0} onClick={() => step(-1)}>−</button>
      <div><label className="sr-only" htmlFor={id}>Note de {label} sur 10, de 0 à 10</label><input id={id} type="number" min="0" max="10" step="1" placeholder="—" value={draft ?? value ?? ''}
        onChange={event => { const raw = event.target.value; setDraft(raw); if (!raw) onChange(null); else if (event.target.validity.valid) onChange(Number(raw)); }}
        onBlur={() => setDraft(undefined)} /><span>/10</span></div>
      <button type="button" aria-label={`Augmenter la note de ${label}`} disabled={value === 10} onClick={() => step(1)}>+</button></div>
    <button className="text-button unrated-button" type="button" aria-pressed={value === null} onClick={() => { setDraft(undefined); onChange(null); }}>{value === null ? 'Pas noté' : `Effacer la note (${number(value)})`}</button>
  </fieldset>;
}
