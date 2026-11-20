export function rerateSynopsisOverflows(scrollHeight: number, lineHeight: number): boolean {
  // scrollHeight is rounded to an integer, including when the paragraph is clamped.
  return scrollHeight > lineHeight * 4 + 1;
}

export function rerateDelta(delta: number | null): string {
  return delta === null ? '—' : delta === 0 ? '=' : delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

export function rerateDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris',
  }).format(new Date(value));
}

export function rerateCount(count: number): string {
  return `${count} film${count > 1 ? 's' : ''} à renoter`;
}

export function parseRerateExclusions(value: string | null): number[] {
  try {
    const ids: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(ids) ? [...new Set(ids.filter((id): id is number =>
      typeof id === 'number' && Number.isSafeInteger(id) && id > 0))].slice(-500) : [];
  } catch { return []; }
}
