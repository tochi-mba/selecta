import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BusinessContext, type BusinessCtx } from '../context';
import { NOW, org } from '../fixtures';
import { gigabytes, meterWords, percentWords, type SloAnswer, type UsageAnswer } from '../hoursAdapters';
import { navItems } from '../shell/nav';
import { UsagePage } from './UsagePage';

const GB = 1_000_000_000;
const USAGE: UsageAnswer = {
  organisation_id: 'crown',
  always_open_confirmed: false,
  storage: { used: 120 * GB, limit: 350 * GB, read_only: false, message: '', unassigned_bytes: 120 * GB },
  derived: { used: 5 * GB, limit: 52.5 * GB },
  seats: { used: 4, limit: 6, billed_extra: 0, extra_needed: 0 },
  zones: { used: 2, limit: 2 },
  analysis: { used: 30, limit: 10000, resets_at: NOW + 3600 },
  lucy: { quick: { used: 10, limit: 600, remaining: 590, resets_at: NOW + 86400 } },
  venues: [{ venue_id: 'camden', name: 'Camden', entitled: true, pilot: false, storage_bytes: 0, zones: { used: 1, limit: 1 }, render: [] }],
};
const SLO: SloAnswer = {
  organisation_id: 'crown', month: '2026-11', targets: { continuity: 0.999, readiness: 0.995 },
  zones: [{ venue_id: 'camden', venue_name: 'Camden', zone_id: 'bar', scheduled_minutes: 100, playing_minutes: 5, silent_minutes: 0, unknown_minutes: 95, excluded_minutes: 0, transitions: 0, transitions_ready: 0, continuity: 1, readiness: null, credit_percent: 0, computed_at: NOW }],
  credits: [],
};

function renderPage(usage: () => Promise<UsageAnswer>, role: 'owner' | 'venue_manager' = 'owner') {
  const client = { usage: vi.fn(usage), slo: vi.fn(async () => SLO), setAlwaysOpen: vi.fn(async () => ({ always_open_confirmed: true })) };
  const ctx = { org: org({ role }), venues: [], devices: [], activity: [], client, now: NOW, offline: false, updatedAt: NOW, health: 'ok', loading: false, readOnly: false, refresh: async () => {}, go: vi.fn() } as unknown as BusinessCtx;
  render(<BusinessContext.Provider value={ctx}><UsagePage /></BusinessContext.Provider>);
  return client;
}

describe('usage words (ADR-0448)', () => {
  it('says meters and percentages plainly', () => {
    expect(meterWords({ used: 120 * GB, limit: 350 * GB }, gigabytes)).toBe('120 GB of 350 GB');
    expect(percentWords(null)).toBe('Not measured yet');
    expect(percentWords(0.99949)).toBe('99.94%');
  });
});

describe('UsagePage (ADR-0448)', () => {
  it('shows the pooled meters, the venues and the continuity with unknown minutes apart', async () => {
    renderPage(async () => USAGE);
    expect(await screen.findByText('120 GB of 350 GB')).toBeInTheDocument();
    expect(screen.getByText('4 of 6')).toBeInTheDocument();
    expect(await screen.findByText('95')).toBeInTheDocument();
    expect(screen.getByText('Not measured yet')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /always open/ })).toBeInTheDocument();
  });

  it('hides the always-open switch from venue managers', async () => {
    renderPage(async () => USAGE, 'venue_manager');
    await screen.findByText('120 GB of 350 GB');
    expect(screen.queryByRole('checkbox', { name: /always open/ })).toBeNull();
  });

  it('says plainly when the role cannot see usage', async () => {
    renderPage(async () => { throw Object.assign(new Error('no'), { status: 403 }); });
    expect(await screen.findByText('Usage is shown to owners, admins and venue managers.')).toBeInTheDocument();
  });

  it('is in the menu only while business.entitlements is on', () => {
    const on = org({ role: 'owner', features: { ...org().features, 'business.entitlements': true } });
    const off = org({ role: 'owner', features: { ...org().features, 'business.entitlements': false } });
    expect(navItems(on).map((item) => item.id)).toContain('usage');
    expect(navItems(off).map((item) => item.id)).not.toContain('usage');
    expect(navItems(org({ role: 'staff', features: on.features })).map((item) => item.id)).not.toContain('usage');
  });
});
