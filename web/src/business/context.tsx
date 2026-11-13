// What every business page shares: the organisation, its venues, the client, the clock, and the
// network state that drives Offline and Degraded (ADR-0453 D3). The shell (BusinessApp) provides it.

import { createContext, useContext } from 'react';
import type { BusinessClient } from './client';
import type { Health, Org, Venue, Device, ActivityEntry } from './types';

export type BusinessCtx = {
  org: Org;
  venues: Venue[];
  devices: Device[];
  activity: ActivityEntry[];
  client: BusinessClient;
  /** Epoch seconds, ticking every 10 s so durations and silent timers move. */
  now: number;
  offline: boolean;
  /** When the overview was last read (epoch seconds), for "Last updated 14:32". */
  updatedAt: number | null;
  health: Health;
  loading: boolean;
  readOnly: boolean;
  refresh: () => Promise<void>;
  /** Go to a business path (`/b/{org}/...`) without a page load. */
  go: (path: string) => void;
};

export const BusinessContext = createContext<BusinessCtx | null>(null);

export function useBusiness(): BusinessCtx {
  const value = useContext(BusinessContext);
  if (!value) throw new Error('useBusiness needs <BusinessContext.Provider>');
  return value;
}

/** Business flags are OFF unless the server says on (BUILD.md rule 3): unlike personal features,
 * an older server that does not mention them must not show them. */
export function businessOn(features: Record<string, boolean> | null | undefined, flag: string): boolean {
  return features?.[flag] === true;
}

/** Business paths. Deep links carry the organisation (D9). */
export const PATHS = {
  start: '/business/start',
  setup: (org: string) => `/b/${org}/setup`,
  hq: (org: string) => `/b/${org}`,
  venues: (org: string) => `/b/${org}/venues`,
  venue: (org: string, venue: string, tab?: string) => `/b/${org}/v/${venue}${tab ? `/${tab}` : ''}`,
  control: (org: string, venue: string) => `/b/${org}/v/${venue}/control`,
  section: (org: string, section: 'schedules' | 'library' | 'requests' | 'people' | 'billing' | 'settings') => `/b/${org}/${section}`,
  pilots: '/admin/business/pilots',
} as const;

export type BusinessRoute =
  | { page: 'start' }
  | { page: 'setup'; org: string }
  | { page: 'hq'; org: string }
  | { page: 'venues'; org: string }
  | { page: 'venue'; org: string; venue: string; tab?: string }
  | { page: 'control'; org: string; venue: string }
  | { page: 'section'; org: string; section: 'schedules' | 'library' | 'requests' | 'people' | 'billing' | 'settings' }
  | null;

export function parseBusinessPath(pathname: string): BusinessRoute {
  if (/^\/business\/start\/?$/.test(pathname)) return { page: 'start' };
  const match = /^\/b\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const org = decodeURIComponent(match[1]);
  const rest = (match[2] ?? '').replace(/\/$/, '');
  if (!rest) return { page: 'hq', org };
  if (rest === '/setup') return { page: 'setup', org };
  if (rest === '/venues') return { page: 'venues', org };
  const venue = /^\/v\/([^/]+)(?:\/([^/]+))?$/.exec(rest);
  if (venue) {
    const id = decodeURIComponent(venue[1]);
    if (venue[2] === 'control') return { page: 'control', org, venue: id };
    return { page: 'venue', org, venue: id, tab: venue[2] };
  }
  const section = /^\/(schedules|library|requests|people|billing|settings)$/.exec(rest);
  if (section) return { page: 'section', org, section: section[1] as 'schedules' };
  return { page: 'hq', org };
}
