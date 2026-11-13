// Who sees which part of the business workspace (ADR-0453 D2, ADR-0452 roles, D16 flags), as
// plain functions so the shell, the tests and the harness agree. The server refuses anyway; this
// only decides what is drawn and where a person lands.

import { businessOn, BusinessRoute, PATHS } from '../context';
import { NAV_LABELS, type NavId } from '../copy/shell';
import type { Org, Role } from '../types';

export type NavItem = { id: NavId; label: string; path: string };

const ALL: Role[] = ['owner', 'admin', 'venue_manager', 'staff', 'viewer'];
const ROLES: Record<NavId, Role[]> = {
  overview: ['owner', 'admin', 'viewer'],
  venues: ['owner', 'admin', 'viewer', 'venue_manager'],
  schedules: ['owner', 'admin', 'viewer', 'venue_manager'],
  library: ['owner', 'admin', 'viewer', 'venue_manager'],
  requests: ['owner', 'admin', 'venue_manager'],
  people: ['owner', 'admin', 'venue_manager'],
  billing: ['owner', 'admin'],
  settings: ['owner', 'admin'],
};

/** The flag(s) a nav item needs; any one of them on is enough. Library and Settings ride on
 * `business.workspaces` itself. */
const FLAGS: Partial<Record<NavId, string[]>> = {
  overview: ['business.console'],
  venues: ['business.console', 'business.venue_view'],
  schedules: ['business.schedules'],
  requests: ['business.rooms'],
  people: ['business.people'],
  billing: ['business.billing'],
};

const ORDER: NavId[] = ['overview', 'venues', 'schedules', 'library', 'requests', 'people', 'billing', 'settings'];

export function flagOn(org: Org, id: NavId) {
  const flags = FLAGS[id];
  return !flags || flags.some((flag) => businessOn(org.features, flag));
}

export function roleAllows(role: Role, id: NavId) { return ROLES[id].includes(role); }

/** The one venue a venue manager or staff member is scoped to, when there is exactly one. */
export function onlyVenue(org: Org): string | null {
  return org.venue_scope && org.venue_scope.length === 1 ? org.venue_scope[0] : null;
}

export function pathFor(org: Org, id: NavId): string {
  switch (id) {
    case 'overview': return PATHS.hq(org.id);
    case 'venues': {
      const one = org.role === 'venue_manager' ? onlyVenue(org) : null;
      return one && businessOn(org.features, 'business.venue_view') ? PATHS.venue(org.id, one) : PATHS.venues(org.id);
    }
    default: return PATHS.section(org.id, id);
  }
}

/** The navigation this person sees, in D2 order. Staff have none: their whole app is S4. */
export function navItems(org: Org): NavItem[] {
  if (org.role === 'staff') return [];
  return ORDER.filter((id) => roleAllows(org.role, id) && flagOn(org, id))
    .map((id) => ({ id, label: NAV_LABELS[id], path: pathFor(org, id) }));
}

/** Where someone lands on `/b/{org}` (D2): staff on S4, a single-venue manager on S3, other
 * managers on Venues, everyone else on HQ (or the first page they have when HQ is off). */
export function landingPath(org: Org): string {
  if (org.role === 'staff') {
    const venue = org.venue_scope?.[0];
    return venue ? PATHS.control(org.id, venue) : PATHS.hq(org.id);
  }
  if (org.role === 'venue_manager') return pathFor(org, 'venues');
  if (flagOn(org, 'overview')) return PATHS.hq(org.id);
  return navItems(org)[0]?.path ?? PATHS.hq(org.id);
}

/** Which nav item a route belongs to, for aria-current. */
export function navIdOf(route: BusinessRoute): NavId | null {
  if (!route) return null;
  switch (route.page) {
    case 'hq': return 'overview';
    case 'venues': case 'venue': return 'venues';
    case 'section': return route.section;
    default: return null;
  }
}

export type Access = 'ok' | 'role' | 'flag';

function inScope(org: Org, venue: string) { return !org.venue_scope || org.venue_scope.includes(venue); }

/** Whether this person may open a route, and if not, why (role or a flag that is off). */
export function access(org: Org, route: NonNullable<BusinessRoute>): Access {
  const role = org.role;
  switch (route.page) {
    case 'start': return 'ok';
    case 'setup': return role === 'owner' || role === 'admin' ? 'ok' : 'role';
    case 'hq': return roleAllows(role, 'overview') ? (flagOn(org, 'overview') ? 'ok' : 'flag') : 'role';
    case 'venues': return roleAllows(role, 'venues') ? (flagOn(org, 'venues') ? 'ok' : 'flag') : 'role';
    case 'venue':
      if (!roleAllows(role, 'venues') || !inScope(org, route.venue)) return 'role';
      return businessOn(org.features, 'business.venue_view') ? 'ok' : 'flag';
    case 'control':
      if (!ALL.includes(role) || role === 'viewer' || !inScope(org, route.venue)) return 'role';
      return businessOn(org.features, 'business.staff_controls') ? 'ok' : 'flag';
    case 'section': return roleAllows(role, route.section) ? (flagOn(org, route.section) ? 'ok' : 'flag') : 'role';
  }
}
