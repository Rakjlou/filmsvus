import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
export function ErrorMessage({ children, retry, action, className = '' }: { children: ReactNode; retry?: () => void; action?: ReactNode; className?: string }) {
  return <div className={`notice error ${className}`} role="alert"><p>{children}</p>{retry && <button type="button" onClick={retry}>Réessayer</button>}{action}</div>;
}
export function Loading({ children = 'On prépare la séance…' }: { children?: ReactNode }) {
  return <div className="loading" role="status"><span className="loading-reel"><Icon name="film" /></span>{children}</div>;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><Icon name="film" /><h2>{title}</h2><div>{children}</div></div>;
}
