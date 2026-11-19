// ADR-0454: on a downgrade the owner picks WHICH zones of a venue stay paid; the rest pause at
// that venue's close (billing_plan.downgrade with keep_zone_ids).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { businessClient } from '../client';
import { BusinessContext, type BusinessCtx } from '../context';
import { BILLING_COPY } from '../copy/console';
import { NOW, org, venue, zone } from '../fixtures';
import type { BillingSummary } from '../types';
import { ZoneDowngradeCard } from './PlanChanges';

const summary = {
  organisation_id: 'org-a', currency: 'GBP', interval: 'month', subscribed: true, status: 'active',
  quantities: { business_venue: 1, business_extra_zone: 2, business_extra_seat: 0 }, enterprise: false,
  prices: [], estimate: null, profile: null, banner: null, read_only: false,
  checkout: { selling: true, terms_version: 'v', trial: { days: 14, venues: 1, zones: 1 }, trial_available: false },
  venues: [{ venue_id: 'camden', name: 'Camden', cost_centre: null, stop_at: null, state: 'active' }],
} as BillingSummary;

function mount() {
  const api = vi.fn(async (path: string, init?: RequestInit) => {
    if (`${init?.method} ${path}` === 'POST /business/billing/downgrade') return { pausing: [] };
    throw new Error(`unexpected ${path}`);
  });
  const camden = venue('camden', 'Camden', { zones: [zone('camden', 'z-bar', 'Bar'), zone('camden', 'z-terrace', 'Terrace'), zone('camden', 'z-garden', 'Garden')] });
  const ctx = {
    org: org(), venues: [camden], devices: [], activity: [],
    client: businessClient(api as unknown as Api, 'ws-crown'), now: NOW, offline: false, updatedAt: NOW,
    health: { stream: 'live' }, loading: false, readOnly: false, refresh: async () => {}, go: vi.fn(),
  } as unknown as BusinessCtx;
  const changed = vi.fn(async () => {});
  render(<BusinessContext.Provider value={ctx}><ZoneDowngradeCard summary={summary} onChanged={changed} /></BusinessContext.Provider>);
  return { api, changed };
}

describe('ZoneDowngradeCard', () => {
  it('sends the zones the owner chose to keep', async () => {
    const { api, changed } = mount();
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: BILLING_COPY.zonesButton('Camden') });
    expect(button).toBeDisabled(); // nothing to pause yet
    await user.click(screen.getByLabelText(BILLING_COPY.keepZone('Bar')));
    await user.click(screen.getByLabelText(BILLING_COPY.keepZone('Terrace')));
    await user.click(button);
    await waitFor(() => expect(changed).toHaveBeenCalled());
    const sent = JSON.parse(String(api.mock.calls[0][1]?.body));
    expect(sent).toEqual({ keep_venue_ids: ['camden'], paid_zones: {}, keep_zone_ids: { camden: ['z-garden'] } });
    expect(screen.getByRole('status')).toHaveTextContent(BILLING_COPY.zonesDowngraded('Camden'));
  });

  it('refuses to keep no zone at all', async () => {
    const { api } = mount();
    const user = userEvent.setup();
    for (const name of ['Bar', 'Terrace', 'Garden']) await user.click(screen.getByLabelText(BILLING_COPY.keepZone(name)));
    await user.click(screen.getByRole('button', { name: BILLING_COPY.zonesButton('Camden') }));
    expect(screen.getByRole('status')).toHaveTextContent(BILLING_COPY.zonesKeepOne);
    expect(api).not.toHaveBeenCalled();
  });
});
