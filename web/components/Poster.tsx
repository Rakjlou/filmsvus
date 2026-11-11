import { useState } from 'react';
import type { CSSProperties } from 'react';
import { posterInitials, safeUrl } from '../format.ts';

export function Poster({ title, src, priority = false }: { title: string; src?: string | null; priority?: boolean }) {
  const [failed, setFailed] = useState<string>();
  const hash = [...title].reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
  const valid = src?.startsWith('/posters/') || safeUrl(src) ? src : null;
  return <div className="poster" style={{ '--poster-hue': Math.abs(hash) % 360 } as CSSProperties}>
    {valid && failed !== valid ? <img src={valid} alt={`Affiche de ${title}`} loading={priority ? 'eager' : 'lazy'} onError={() => setFailed(valid)} />
      : <div className="poster-fallback" role="img" aria-label={`Pas d’affiche pour ${title}`}><span className="poster-perforations" /><span className="poster-initials">{posterInitials(title)}</span><span className="poster-caption">FLEUR & NOÉ · CINÉMATHÈQUE</span></div>}
  </div>;
}
