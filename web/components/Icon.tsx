const paths = {
  account: 'M20 21v-2a7 7 0 0 0-14 0v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  film: 'M4 3h16v18H4zM8 3v18M16 3v18M4 8h4M4 16h4M16 8h4M16 16h4',
  plus: 'M12 5v14M5 12h14',
  rerate: 'M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2',
  stats: 'M4 20V10M12 20V4M20 20v-7',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  filter: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  rows: 'M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1',
  arrow: 'M12 4v16M6 14l6 6 6-6',
  close: 'M5 5l14 14M5 19L19 5',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2',
  moon: 'M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13',
  back: 'M19 12H5M11 6l-6 6 6 6',
  edit: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4',
  sparkle: 'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
  check: 'M5 12l4 4L20 5',
  external: 'M14 3h7v7M21 3L10 14M10 3H3v18h18v-7',
} as const;
export function Icon({ name, className = '' }: { name: keyof typeof paths; className?: string }) {
  return <svg className={`icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
