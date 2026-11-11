// ExcelJS exposes formula cells as { formula, result } and hyperlinks separately.
export function cachedValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('formula' in value || 'sharedFormula' in value) {
      return cachedValue('result' in value ? value.result : null);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part: { text: string }) => part.text).join('');
    }
    if ('text' in value) return value.text;
    if ('error' in value) return null;
  }
  return value;
}

// ExcelJS's cell.value getter drops falsy formula results; cell.result keeps 0.
// Keep this structural (no ExcelJS dependency) so the adapter is unit-testable.
export function excelCellValue(cell: { value: unknown; result?: unknown }): unknown {
  const value = cell.value;
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    return cell.result ?? cachedValue(value);
  }
  return value;
}

export function parseText(value: unknown): string | null {
  const plain = cachedValue(value);
  if (plain === null || plain === undefined) return null;
  const text = String(plain).trim();
  return text || null;
}

export function parseTitle(value: unknown): string {
  const text = parseText(value);
  if (!text) throw new Error('Titre manquant');
  return /^\d+\.0+$/.test(text) ? String(Number(text)) : text;
}

export function parseScore(value: unknown): number | null {
  const text = parseText(value);
  if (text === null || text === '-') return null;
  const number = Number(text.replace(',', '.'));
  if (!Number.isFinite(number) || number < -10 || number > 10) {
    throw new Error(`Note invalide : ${text}`);
  }
  return number;
}

export const PARIS = 'Europe/Paris';
const parisClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function wallMilliseconds(date: Date): number {
  const parts = Object.fromEntries(parisClock.formatToParts(date).map(p => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second), date.getUTCMilliseconds());
}

// Excel dates have no timezone: their UTC components describe the Paris wall clock.
// Try both DST offsets. At the autumn overlap choose the earlier instant;
// a nonexistent spring wall time is rejected instead of silently moved.
export function parisWallToISO(wall: Date): string {
  const milliseconds = wall.getTime();
  if (!Number.isFinite(milliseconds)) throw new Error('Date Excel invalide');
  const candidates = [1, 2].map(hours => new Date(milliseconds - hours * 3_600_000))
    .filter(date => wallMilliseconds(date) === milliseconds);
  const first = candidates.sort((a, b) => a.getTime() - b.getTime())[0];
  if (!first) throw new Error(`Heure inexistante en Europe/Paris : ${wall.toISOString()}`);
  return first.toISOString();
}

export function parseExcelDate(value: unknown, date1904 = false): string {
  const plain = cachedValue(value);
  if (plain instanceof Date) return parisWallToISO(plain);
  if (typeof plain !== 'number' || !Number.isFinite(plain) || plain < 0) {
    throw new Error(`Date Excel invalide : ${String(plain)}`);
  }
  const days = date1904 ? plain : plain - (plain >= 60 ? 1 : 0);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  return parisWallToISO(new Date(epoch + Math.round(days * 86_400_000)));
}

export function ratingMetrics(scores: (number | null)[]) {
  const present = scores.filter((n): n is number => n !== null);
  const avg = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
  return {
    avg,
    gap: present.length >= 2 ? Math.max(...present) - Math.min(...present) : null,
    letterboxd_rating: avg === null ? null : Math.round(avg) / 2,
  };
}

export function parseLetterboxd(value: unknown): { url: string | null; comment: string | null } {
  const link = value && typeof value === 'object' && 'hyperlink' in value ? value.hyperlink : value;
  const text = parseText(link);
  if (text) {
    try {
      const url = new URL(text);
      if (['http:', 'https:'].includes(url.protocol)) return { url: url.href, comment: null };
    } catch { /* Non-URL cells are retained as plain comment text. */ }
  }
  return { url: null, comment: text ? `Letterboxd : ${text}` : null };
}
