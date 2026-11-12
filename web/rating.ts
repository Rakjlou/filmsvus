export function stepRating(value: number | null, direction: -1 | 1) {
  return value === null ? 5 : Math.max(0, Math.min(10, Math.round(value) + direction));
}
