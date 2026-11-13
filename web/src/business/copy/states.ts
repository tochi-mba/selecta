// Manager-facing copy for the D3 states (ADR-0453 D7, D8, D9, D10, D15). Manager copy only:
// a build test (customerSeparation.test.ts) fails if this module or any of its keys reaches the
// kiosk, guest or display bundles. Plain words, no blame, no exclamation marks, SelectaDJ.

import type { BusinessState } from '../state';
import type { Org, Venue } from '../types';
import { dayWords, duration, isoDayWords } from '../time';

export type StateContext = { org: Org; venues: Venue[]; now: number; scope: 'hq' | 'venue' };

const venueOf = (ctx: StateContext, id?: string) => ctx.venues.find((venue) => venue.id === id);
const zoneOf = (ctx: StateContext, venueId?: string, zoneId?: string) => venueOf(ctx, venueId)?.zones.find((zone) => zone.id === zoneId);

export const MANAGER_COPY = {
  liveUpdatesPaused: 'Live updates are paused on this network. Refreshing every 10 seconds',
  commandsSlow: 'Changes may take longer to reach the players',
  offlineHq: (time: string) => `Last updated ${time}. You're offline`,
  offlineControls: "You're offline",
  paymentNoBilling: "There's a payment problem. Your owner has been told",
  readOnlyAction: 'Update payment to make changes',
  pilotReadOnly: 'Your pilot has ended. Talk to REX Technologies to keep going',
  staffManagerLine: 'Your manager has a note about this venue',
  staffLastDay: 'The music will stop at closing time tonight. Your owner knows why',
  notReporting: 'Not reporting',
  needsYou: 'Needs you',
  checkingVenues: 'Checking venues',
} as const;

/** The sentence a banner or Needs attention row says for a state. */
export function stateWords(state: BusinessState, ctx: StateContext): string {
  const venue = venueOf(ctx, state.venue_id);
  const zone = zoneOf(ctx, state.venue_id, state.zone_id);
  const billingRights = ctx.org.role === 'owner' || ctx.org.role === 'admin';
  switch (state.kind) {
    case 'silent_zone':
      return `${zone?.name ?? 'A zone'}${ctx.scope === 'hq' && venue ? ` at ${venue.name}` : ''} is silent${state.since ? ` for ${duration(ctx.now - state.since)}` : ''}`;
    case 'long_pause':
      return `${zone?.name ?? 'A zone'}${ctx.scope === 'hq' && venue ? ` at ${venue.name}` : ''} has been paused by staff for ${duration(ctx.now - (state.since ?? ctx.now))}`;
    case 'licence_expired': {
      const by = state.until ? dayWords(state.until, venue?.time_zone) : '';
      const off = state.until != null && ctx.now > state.until;
      return off
        ? `${venue?.name ?? 'This venue'}'s music is off until the licence is updated`
        : `${venue?.name ?? 'This venue'}'s music licence date has passed. Update it by ${by} or ${venue?.name ?? 'the venue'}'s music won't start at its next opening after that`;
    }
    case 'licence_expiring':
      return `${venue?.name ?? 'This venue'}'s music licence ends on ${venue?.licence ? isoDayWords(venue.licence.expires_on) : ''}`;
    case 'payment_grace':
      if (!billingRights) return MANAGER_COPY.paymentNoBilling;
      return `Your last payment didn't go through. Update your card by ${state.until ? dayWords(state.until) : 'the end of grace'} to keep everything running`;
    case 'payment_grace_final':
      if (!billingRights) return MANAGER_COPY.paymentNoBilling;
      if (ctx.org.billing.status === 'grace_ended') return `Management is read only. ${MANAGER_COPY.readOnlyAction}`;
      return `Music in all venues stops at closing time on ${state.until ? dayWords(state.until) : 'the last day of grace'} unless payment is updated`;
    case 'pilot_ending':
      return `Your pilot ends on ${state.until ? dayWords(state.until) : ''}. Talk to REX Technologies to keep going`;
    case 'pilot_ended':
      return `${MANAGER_COPY.pilotReadOnly}. Music stops at each venue's closing time`;
    case 'over_seats': {
      const { held, included, paid } = ctx.org.seats;
      return `${held} people hold seats but ${included + paid} are ${paid ? 'included or paid' : 'included'}. Remove someone or add seats`;
    }
    case 'offline':
      return "You're offline. What you see is the last known state";
    case 'degraded':
      return MANAGER_COPY.liveUpdatesPaused;
    case 'plan_locked': {
      if (zone) return ctx.org.role === 'owner'
        ? `${zone.name} is paused because your plan covers fewer zones. Its music stops at closing time. Add a zone to keep it playing`
        : `${zone.name} is paused because your plan covers fewer zones. Its music stops at closing time`;
      const feature = state.key.split(':')[1] ?? '';
      const plan = state.key.split(':')[2] ?? '';
      return `${FEATURE_NAMES[feature] ?? 'This feature'} is part of ${plan ? plan[0].toUpperCase() + plan.slice(1) : 'another plan'}`;
    }
  }
}

export const FEATURE_NAMES: Record<string, string> = {
  'business.sso': 'Single sign-on',
  'business.zones': 'Another zone',
  'business.rooms': 'Rooms for Business',
};

/** The words for a Needs attention group heading when several of one kind collect (500 venues). */
export function groupWords(kind: BusinessState['kind'], count: number): string {
  const plural = count === 1 ? '' : 's';
  switch (kind) {
    case 'licence_expiring': return `${count} licence${plural} end this month`;
    case 'licence_expired': return `${count} licence${plural} have passed their date`;
    case 'silent_zone': return `${count} silent zone${plural}`;
    case 'long_pause': return `${count} zone${plural} paused for a long time`;
    case 'plan_locked': return `${count} item${plural} need a different plan`;
    default: return `${count} note${plural}`;
  }
}
