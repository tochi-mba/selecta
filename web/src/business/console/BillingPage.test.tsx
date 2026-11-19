// The billing page reads and writes the business billing routes (ADR-0447) through the business
// client, in the organisation's workspace, and only for owners and admins.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { businessClient } from '../client';
import { BusinessContext, type BusinessCtx } from '../context';
import { BILLING_COPY } from '../copy/console';
import { NOW, org, venue } from '../fixtures';
import type { BillingSummary, Org } from '../types';
import { BillingPage } from './BillingPage';

function summary(extra: Partial<BillingSummary> = {}): BillingSummary {
  return {
    currency: 'GBP', interval: 'month', subscribed: false, status: null,
    quantities: { business_venue: 2, business_extra_zone: 1, business_extra_seat: 0 }, enterprise: false,
    prices: [{ item: 'business_venue', unit_amount: 7900, interval: 'month' }, { item: 'business_extra_zone', unit_amount: 2500, interval: 'month' }],
    estimate: { lines: { business_venue: 15800, business_extra_zone: 2500, business_extra_seat: 0 }, subtotal_minor: 18300, discount_minor: 0, total_minor: 18300 },
    profile: null,
    venues: [{ venue_id: 'camden', name: 'Camden', cost_centre: null, stop_at: null }],
    checkout: { selling: false, terms_version: '2026-11-12', trial: { days: 14, venues: 1, zones: 1 }, trial_available: false },
    banner: null, read_only: false, ...extra,
  };
}

function page(answers: Record<string, unknown>, who: Partial<Org> = {}) {
  const api = vi.fn(async (path: string, init?: RequestInit) => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${path}`;
    if (key in answers) return answers[key];
    throw new Error(`unexpected ${key}`);
  });
  const ctx = {
    org: org(who), venues: [venue('camden', 'Camden')], devices: [], activity: [],
    client: businessClient(api as unknown as Api, 'ws-crown'), now: NOW, offline: false, updatedAt: NOW,
    health: { stream: 'live' }, loading: false, readOnly: false, refresh: async () => {}, go: vi.fn(),
  } as BusinessCtx;
  render(<BusinessContext.Provider value={ctx}><BillingPage /></BusinessContext.Provider>);
  return api;
}

afterEach(() => vi.restoreAllMocks());

describe('billing page', () => {
  it('shows prices and checks the cost of an extra zone before adding it', async () => {
    const api = page({
      'GET /business/billing': summary(),
      'POST /business/billing/preview': { source: 'estimate', currency: 'GBP', interval: 'month', period_total_minor: 20800 },
    });
    expect(await screen.findByText(BILLING_COPY.pricesCaption('month'))).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/business/billing', undefined, 'ws-crown');

    const zones = screen.getByLabelText(BILLING_COPY.addZones);
    await userEvent.clear(zones);
    await userEvent.type(zones, '1');
    await userEvent.click(screen.getByRole('button', { name: BILLING_COPY.previewButton }));

    expect(await screen.findByText(BILLING_COPY.previewEstimate('£208', 'month'))).toBeInTheDocument();
    const [, init] = api.mock.calls.find(([path]) => path === '/business/billing/preview')!;
    expect(JSON.parse(String(init?.body))).toEqual({ venues: 0, zones: 1, seats: 0 });
  });

  it('says what Stripe will charge once there is a subscription', async () => {
    page({
      'GET /business/billing': summary({ subscribed: true }),
      'POST /business/billing/preview': { source: 'stripe', currency: 'GBP', charged_now_minor: 1250, next_invoice_minor: 24000 },
    });
    await userEvent.click(await screen.findByRole('button', { name: BILLING_COPY.previewButton }));
    expect(await screen.findByText(BILLING_COPY.previewStripe('£12.50', '£240'))).toBeInTheDocument();
  });

  it('saves a cost centre and downloads the cost breakdown', async () => {
    const created = vi.fn(() => 'blob:breakdown');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const api = page({
      'GET /business/billing': summary(),
      'PUT /business/billing/venues/camden/cost-centre': { venue_id: 'camden', cost_centre: 'CC-1' },
      'GET /business/billing/cost-breakdown': { filename: 'selectadj-cost-breakdown.csv', csv: 'venue\nCamden\n' },
    });
    await userEvent.type(await screen.findByLabelText(BILLING_COPY.costCentre('Camden')), 'CC-1');
    await userEvent.click(screen.getAllByRole('button', { name: BILLING_COPY.save })[0]);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/business/billing/venues/camden/cost-centre', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ cost_centre: 'CC-1' }) }), 'ws-crown'));

    await userEvent.click(screen.getByRole('button', { name: BILLING_COPY.breakdown }));
    await waitFor(() => expect(created).toHaveBeenCalled());
  });

  it('offers the PO number and bank transfer only when they apply', async () => {
    page({ 'GET /business/billing': summary() });
    expect(await screen.findByText(BILLING_COPY.noProfile)).toBeInTheDocument();
    expect(screen.queryByLabelText(BILLING_COPY.poNumber)).toBeNull();
    expect(screen.queryByText(BILLING_COPY.collection)).toBeNull();
  });

  it('saves the PO number and switches a yearly plan to bank transfer', async () => {
    const profile = { company_name: 'Crown Ltd', country: 'GB', po_number: null, collection_method: 'charge_automatically' as const, net_days: null, tax_treatment: 'uk_vat', can_send_invoice: true };
    const api = page({
      'GET /business/billing': summary({ interval: 'year', profile }),
      'PUT /business/billing/po-number': { po_number: 'PO-9' },
      'PUT /business/billing/collection-method': { collection_method: 'send_invoice', net_days: 30 },
    });
    await userEvent.type(await screen.findByLabelText(BILLING_COPY.poNumber), 'PO-9');
    await userEvent.click(screen.getAllByRole('button', { name: BILLING_COPY.save })[0]);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/business/billing/po-number', expect.objectContaining({ body: JSON.stringify({ po_number: 'PO-9' }) }), 'ws-crown'));

    await userEvent.click(await screen.findByLabelText(BILLING_COPY.byTransfer(30)));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/business/billing/collection-method', expect.objectContaining({ body: JSON.stringify({ method: 'send_invoice' }) }), 'ws-crown'));
  });

  it('sends 25 or more venues to Enterprise instead of a price check', async () => {
    page({ 'GET /business/billing': summary({ enterprise: true, estimate: null }) });
    expect(await screen.findByText(BILLING_COPY.enterprise)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BILLING_COPY.previewButton })).toBeNull();
  });

  it('shows each venue stop while a payment is in grace', async () => {
    page({ 'GET /business/billing': summary({ banner: { message: 'A SelectaDJ payment failed.', grace_ends_at: NOW, read_only: true, stops: [{ venue_id: 'camden', stop_at: NOW + 3 * 86_400 }] } }) });
    expect(await screen.findByText('A SelectaDJ payment failed.')).toBeInTheDocument();
    expect(screen.getByText(/Camden stops playing at its close/)).toBeInTheDocument();
  });

  it('tells staff to ask an owner and reads nothing', () => {
    const api = page({}, { role: 'staff' });
    expect(screen.getByText(BILLING_COPY.noRights)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });
});
