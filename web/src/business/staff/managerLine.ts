// The single manager line on S4 (ADR-0453 D4): S4 is semi-public, so manager states (licence,
// payment, pilot, seats) show only as one quiet line at the foot, in plain words with no amounts,
// and only when the person signed in, or the PIN holder on a shared tablet, is a manager. On a
// shared tablet (PINs on) the signed-in account does not count: without a manager PIN it never
// shows.

import { MANAGER_COPY } from '../copy/states';
import { deriveStates, isManager, type StateKind } from '../state';
import type { Org, Role, Venue } from '../types';

const DAY = 86_400;
const NOTE_KINDS: StateKind[] = [
  'licence_expiring', 'licence_expired', 'payment_grace', 'payment_grace_final', 'pilot_ending', 'pilot_ended', 'over_seats',
];

export const MANAGER_ROLES: Role[] = ['owner', 'admin', 'venue_manager'];

/** Is the person looking at this screen a manager? */
export function viewerIsManager(org: Org, pinsOn: boolean, holderRole: Role | null | undefined): boolean {
  if (pinsOn) return holderRole != null && MANAGER_ROLES.includes(holderRole);
  return isManager(org);
}

/** Payment grace on its last day (or ended, so the music stops at this close). */
export function graceLastDay(org: Org, now: number): boolean {
  const billing = org.billing;
  if (billing.status === 'grace_ended') return true;
  return billing.status === 'grace' && billing.grace_ends_at != null && billing.grace_ends_at - now <= DAY;
}

export function staffManagerLine({ org, venue, now, manager }: { org: Org; venue: Venue | null; now: number; manager: boolean }): string | null {
  if (!manager) return null;
  if (graceLastDay(org, now)) return MANAGER_COPY.staffLastDay;
  const states = deriveStates({ org, venues: venue ? [venue] : [], now });
  return states.some((state) => NOTE_KINDS.includes(state.kind)) ? MANAGER_COPY.staffManagerLine : null;
}
