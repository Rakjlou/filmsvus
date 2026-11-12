export const normalizeTitle = (value: string): string => value.normalize('NFD').replace(/\p{M}/gu, '')
  .toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]/gu, '');
