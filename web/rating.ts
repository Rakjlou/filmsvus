export function stepRating(value: number | null, direction: -1 | 1) {
  return value === null ? 5 : Math.max(-10, Math.min(10, Math.round((value + direction * .5) * 2) / 2));
}
