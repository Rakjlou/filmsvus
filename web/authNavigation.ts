export function safeNext(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') && !/[\\\x00-\x1f\x7f]/.test(value) ? value : '/';
}
