// What every S3 tab shares (ADR-0453 D8): the venue, its own states (venue-scoped plus the
// organisation-wide ones), the reason changing controls are off, and venue-time helpers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBusiness, type BusinessCtx } from '../context';
import { MANAGER_COPY } from '../copy/states';
import { VENUE_COPY } from '../copy/venue';
import { deriveStates, isManager, splitBanners, type BusinessState } from '../state';
import type { Venue } from '../types';

/** Why changing controls are off right now, or null when they work (BUILD rule: read-only, offline). */
export function disabledReason(ctx: Pick<BusinessCtx, 'org' | 'readOnly' | 'offline' | 'now'>): string | null {
  if (ctx.readOnly) {
    const pilot = ctx.org.pilot;
    const pilotEnded = pilot && pilot.status !== 'converted' && (pilot.status === 'ended' || pilot.ends_at <= ctx.now);
    return pilotEnded && ctx.org.billing.status !== 'grace_ended' ? MANAGER_COPY.pilotReadOnly : MANAGER_COPY.readOnlyAction;
  }
  if (ctx.offline) return VENUE_COPY.offline;
  if (!isManager(ctx.org)) return VENUE_COPY.viewerReadOnly;
  return null;
}

/** Minutes after midnight in the venue's time zone. */
export function venueMinutes(epochSeconds: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epochSeconds * 1000));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/** The id this browser registered as a device in this workspace (the same key DevicesPanel reads),
 * so Play here can name it. Null when this browser never registered, and then Play here is not offered. */
export function thisDeviceId(workspaceId: string): string | null {
  try { return localStorage.getItem(`selecta.device.${workspaceId}`); } catch { return null; }
}

export type VenueView = {
  ctx: BusinessCtx;
  venue: Venue | undefined;
  states: BusinessState[];
  banners: BusinessState[];
  attention: BusinessState[];
  silent: BusinessState[];
  disabled: string | null;
};

export function useVenueView(venueId: string): VenueView {
  const ctx = useBusiness();
  const venue = ctx.venues.find((item) => item.id === venueId);
  return useMemo(() => {
    const states = venue ? deriveStates({ org: ctx.org, venues: [venue], health: ctx.health, offline: ctx.offline, now: ctx.now }) : [];
    const silent = states.filter((state) => state.kind === 'silent_zone');
    // The payment notice for people without billing rights is its own line (D8), so it is not repeated as a banner.
    const billingRights = ctx.org.role === 'owner' || ctx.org.role === 'admin';
    const forBanners = states.filter((state) => state.kind !== 'silent_zone' && (billingRights || (state.kind !== 'payment_grace' && state.kind !== 'payment_grace_final')));
    const { banners, attention } = splitBanners(forBanners);
    return { ctx, venue, states, banners, attention, silent, disabled: disabledReason(ctx) };
  }, [ctx, venue]);
}

/** A small read hook: data, error, loading and a reload, ignoring answers that arrive after unmount. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: unknown; loading: boolean; reload: () => Promise<void>; set: (value: T) => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const value = await run();
      if (alive.current) { setData(value); setError(null); }
    } catch (problem) {
      if (alive.current) setError(problem);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, set: setData };
}

/** The code and payload of a refused call (CloudError carries both). */
export function refusal(error: unknown): { status?: number; code?: string; detail: Record<string, unknown> } {
  const value = (error ?? {}) as { status?: number; code?: string; payload?: unknown };
  const payload = (value.payload ?? {}) as Record<string, unknown>;
  const detail = (payload.detail && typeof payload.detail === 'object' ? payload.detail : payload) as Record<string, unknown>;
  const code = value.code ?? (typeof detail.code === 'string' ? detail.code : undefined);
  return { status: value.status, code, detail };
}
