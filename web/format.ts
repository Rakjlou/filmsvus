export const number = (value: number | null | undefined, digits = 1) => value == null ? '—'
  : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(value);
export const date = (value: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(value));
export function localDateTime(value = new Date().toISOString()) {
  const at = new Date(value);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function watchedYear(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(value));
}
export function scoreTone(score: number | null | undefined) {
  return score == null ? 'unrated' : score < 0 ? 'negative' : score < 5 ? 'low' : score < 7 ? 'neutral' : score < 9 ? 'good' : 'gold';
}
export const safeUrl = (url: string | null | undefined) => url && /^https?:\/\//i.test(url) ? url : undefined;
