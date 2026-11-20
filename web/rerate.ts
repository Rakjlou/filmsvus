export function rerateSynopsisOverflows(scrollHeight: number, lineHeight: number): boolean {
  // scrollHeight is rounded to an integer, including when the paragraph is clamped.
  return scrollHeight > lineHeight * 4 + 1;
}

export function rerateDelta(delta: number | null): string {
  return delta === null ? '—' : delta === 0 ? '=' : delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

export function rerateCount(count: number): string {
  return `${count} film${count > 1 ? 's' : ''} à renoter`;
}

export function capRerateExclusions(ids: number[]): number[] {
  return [...new Set(ids)].slice(-500);
}

export function parseRerateExclusions(value: string | null): number[] {
  try {
    const ids: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(ids) ? capRerateExclusions(ids.filter((id): id is number =>
      typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) : [];
  } catch { return []; }
}
