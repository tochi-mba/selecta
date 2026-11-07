import type { SVGProps } from 'react';

const paths = {
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M6 6h12v12H6Z',
  next: 'm5 5 11 7-11 7ZM19 5v14',
  previous: 'm19 5-11 7 11 7ZM5 5v14',
  volume: 'M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
  muted: 'M11 4 6 8H3v8h3l5 4ZM16 9l6 6M22 9l-6 6',
  music: 'M9 18V5l11-2v13M9 8l11-2M9 18c0 3-6 4-6 1s6-4 6-1ZM20 16c0 3-6 4-6 1s6-4 6-1Z',
  mixes: 'M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z',
  library: 'M4 5h16M4 12h16M4 19h16',
  discover: 'm12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  edit: 'm14 5 5 5M4 20l5-1L21 7l-5-5L4 14Z',
  close: 'm6 6 12 12M18 6 6 18',
  check: 'm5 12 4 4L19 6',
  warning: 'm12 3 10 18H2ZM12 9v5M12 17v.1',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  minus: 'M5 12h14',
  more: 'M5 12h.1M12 12h.1M19 12h.1',
  help: 'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  up: 'm6 14 6-6 6 6',
  down: 'm6 10 6 6 6-6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  plus: 'M12 5v14M5 12h14',
  search: 'm20 20-4.5-4.5M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
  grip: 'M9 6h.1M9 12h.1M9 18h.1M15 6h.1M15 12h.1M15 18h.1',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4ZM10 21h4',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  explore: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM16 8l-2.5 5.5L8 16l2.5-5.5Z',
  folder: 'M3 7h6l2 2h10v10H3Z',
  rail: 'M4 4h16v16H4ZM10 4v16',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z',
  lock: 'M6 11h12v9H6ZM8 11V8a4 4 0 0 1 8 0v3',
  request: 'M12 4v10M8 10l4 4 4-4M5 20h14',
  circle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  half: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 3v18M12 7h4M12 11h5M12 15h5M12 19h2',
  dot: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  sun: 'M12 3V2M12 22v-1M4 12H3M21 12h-1M6.3 6.3l-.7-.7M18.4 18.4l-.7-.7M17.7 6.3l.7-.7M5.6 18.4l.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M21 13.5A9 9 0 1 1 10.5 3a7 7 0 0 0 10.5 10.5Z',
  system: 'M3 5h18v12H3ZM8 21h8M12 17v4',
} as const;

export type IconName = keyof typeof paths;

/** Local vectors share a 24px grid; the containing control supplies its accessible name. */
export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg {...props} className={`ui-icon ${props.className ?? ''}`} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
