// Plan changes and the venue's own play-log export call their server routes (ADR-0447 BZ-0447-10,
// -11; ADR-0449 BZ-0449-06).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { businessClient } from '../client';
import { BusinessContext, type BusinessCtx } from '../context';
import { BILLING_COPY, EXPORT_COPY } from '../copy/console';
import { NOW, org, venue } from '../fixtures';
import { PlayLogExport } from '../settings/PlayLogExport';
import type { BillingSummary } from '../types';
import { DowngradeCard, TransferCard } from './PlanChanges';

const summary: BillingSummary = {
  organisation_id: 'org-a', currency: 'GBP', interval: 'month', subscribed: true, status: 'active',
  quantities: { business_venue: 2, business_extra_zone: 0, business_extra_seat: 0 }, enterprise: false,
  prices: [], estimate: null, profile: null, banner: null, read_only: false,
  checkout: { selling: true, terms_version: 'v', trial: { days: 14, venues: 1, zones: 1 }, trial_available: false },
  venues: [
    { venue_id: 'camden', name: 'Camden', cost_centre: null, stop_at: null, state: 'active' },
    { venue_id: 'soho', name: 'Soho', cost_centre: null, stop_at: null, state: 'active' },
    { venue_id: 'leeds', name: 'Leeds', cost_centre: null, stop_at: null, state: 'paused' },
  ],
};

function mount(node: ReactElement, answers: Record<string, unknown>) {
  const api = vi.fn(async (path: string, init?: RequestInit) => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${path}`;
    if (key in answers) return answers[key];
    throw new Error(`unexpected ${key}`);
  });
  const ctx = {
    org: org({ features: { ...org().features, 'business.licensing': true } }), venues: [venue('camden', 'Camden')], devices: [], activity: [],
    client: businessClient(api as unknown as Api, 'ws-crown'), now: NOW, offline: false, updatedAt: NOW,
    health: { stream: 'live' }, loading: false, readOnly: false, refresh: async () => {}, go: vi.fn(),
  } as BusinessCtx;
  render(<BusinessContext.Provider value={ctx}>{node}</BusinessContext.Provider>);
  return api;
}

const body = (api: ReturnType<typeof mount>, path: string) => JSON.parse(String(api.mock.calls.find(([p, init]) => p === path && init?.method === 'POST')![1]?.body));

describe('plan changes', () => {
  it('keeps the ticked venues and brings a paused one back', async () => {
    const changed = vi.fn(async () => {});
    const api = mount(<DowngradeCard summary={summary} onChanged={changed} />, {
      'POST /business/billing/downgrade': { pausing: [{ venue_id: 'soho', pause_at: NOW + 3600 }] },
      'POST /business/billing/venues/leeds/resume': { venue_id: 'leeds', state: 'active' },
    });
    await userEvent.click(screen.getByLabelText(BILLING_COPY.keepVenue('Soho')));
    await userEvent.click(screen.getByRole('button', { name: BILLING_COPY.downgradeButton }));
    expect(await screen.findByText(BILLING_COPY.downgraded(1))).toBeInTheDocument();
    expect(body(api, '/business/billing/downgrade')).toEqual({ keep_venue_ids: ['camden'], paid_zones: {} });

    await userEvent.click(screen.getByRole('button', { name: BILLING_COPY.resumeVenue('Leeds') }));
    expect(await screen.findByText(BILLING_COPY.resumed('Leeds'))).toBeInTheDocument();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('asks to move a venue and accepts one moving in', async () => {
    const api = mount(<TransferCard summary={summary} />, {
      'GET /business/billing/transfers': { organisation_id: 'org-a', transfers: [
        { id: 't1', venue_id: 'x', source_organisation_id: 'org-b', target_organisation_id: 'org-a', state: 'proposed', effective_at: null },
      ] },
      'POST /business/billing/transfers': { transfer: { id: 't2', state: 'proposed' } },
      'POST /business/billing/transfers/t1/accept': { transfer: { id: 't1', state: 'agreed' } },
    });
    expect(await screen.findByText(BILLING_COPY.yourId('org-a'))).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: BILLING_COPY.acceptTransfer }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/business/billing/transfers/t1/accept', expect.anything(), 'ws-crown'));

    await userEvent.type(screen.getByLabelText(BILLING_COPY.targetOrg), 'org-c');
    await userEvent.click(screen.getByRole('button', { name: BILLING_COPY.transferButton }));
    expect(await screen.findByText(BILLING_COPY.transferAsked)).toBeInTheDocument();
    expect(body(api, '/business/billing/transfers')).toEqual({ venue_id: 'camden', target_organisation_id: 'org-c' });
  });
});

describe("a venue's play log tab", () => {
  it('exports that venue without asking which', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const api = mount(<PlayLogExport venueId="camden" />, {
      'GET /business/play-log/export?venue_id=camden&from=2026-11-01&to=2026-11-02': { filename: 'log.csv', csv: 'x' },
    });
    expect(screen.queryByLabelText(EXPORT_COPY.venue)).toBeNull();
    await userEvent.type(screen.getByLabelText(EXPORT_COPY.from), '2026-11-01');
    await userEvent.type(screen.getByLabelText(EXPORT_COPY.to), '2026-11-02');
    await userEvent.click(screen.getByRole('button', { name: EXPORT_COPY.start }));
    expect(await screen.findByText(EXPORT_COPY.ready('log.csv'))).toBeInTheDocument();
    expect(api).toHaveBeenCalled();
  });
});
