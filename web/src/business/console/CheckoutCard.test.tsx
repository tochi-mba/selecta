// The business checkout and the play-log export call their server routes in the organisation's
// workspace (ADR-0447 BZ-0447-06, ADR-0449 BZ-0449-06).
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { businessClient } from '../client';
import { BusinessContext, type BusinessCtx } from '../context';
import { BILLING_COPY, EXPORT_COPY } from '../copy/console';
import { NOW, org, venue } from '../fixtures';
import { PlayLogExport } from '../settings/PlayLogExport';
import type { BillingSummary, Org } from '../types';
import { BillingPage } from './BillingPage';
import { navigate } from './CheckoutCard';

const summary = (trial = true): BillingSummary => ({
  currency: 'GBP', interval: 'month', subscribed: false, status: null,
  quantities: { business_venue: 1, business_extra_zone: 0, business_extra_seat: 0 }, enterprise: false,
  prices: [], estimate: null, profile: null, venues: [], banner: null, read_only: false,
  checkout: { selling: true, terms_version: '2026-11-12', trial: { days: 14, venues: 1, zones: 1 }, trial_available: trial },
});

function mount(node: ReactElement, answers: Record<string, unknown>, who: Partial<Org> = {}) {
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
  render(<BusinessContext.Provider value={ctx}>{node}</BusinessContext.Provider>);
  return api;
}

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('business checkout', () => {
  it('sends the B2B answers and goes to Stripe for the card', async () => {
    const go = vi.spyOn(navigate, 'to').mockImplementation(() => {});
    const api = mount(<BillingPage />, {
      'GET /business/billing': summary(),
      'POST /business/billing/checkout': { blocked: false, url: 'https://checkout.stripe.com/c/pay/cs_test_1' },
    });
    await userEvent.click(await screen.findByLabelText(BILLING_COPY.businessConfirm));
    await userEvent.click(screen.getByLabelText(BILLING_COPY.termsAccept('2026-11-12')));
    await userEvent.type(screen.getByLabelText(BILLING_COPY.line1), '1 High St');
    await userEvent.type(screen.getByLabelText(BILLING_COPY.city), 'London');
    await userEvent.type(screen.getByLabelText(BILLING_COPY.postalCode), 'N1 1AA');
    await userEvent.click(screen.getByLabelText(BILLING_COPY.trialChoice(14)));
    await userEvent.click(screen.getByRole('button', { name: BILLING_COPY.continueToStripe }));

    await waitFor(() => expect(go).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'));
    const [, init] = api.mock.calls.find(([path]) => path === '/business/billing/checkout')!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      business_confirmed: true, terms_version: '2026-11-12', company_name: 'The Crown Group',
      billing_address: { line1: '1 High St', city: 'London', postal_code: 'N1 1AA', country: 'GB' }, interval: 'month', trial: true,
    });
  });

  it('shows why an EU sale is blocked instead of going to Stripe', async () => {
    const go = vi.spyOn(navigate, 'to').mockImplementation(() => {});
    mount(<BillingPage />, {
      'GET /business/billing': summary(false),
      'POST /business/billing/checkout': { blocked: true, message: 'Check the VAT number.' },
    });
    await userEvent.click(await screen.findByLabelText(BILLING_COPY.businessConfirm));
    await userEvent.click(screen.getByLabelText(BILLING_COPY.termsAccept('2026-11-12')));
    for (const label of [BILLING_COPY.line1, BILLING_COPY.city, BILLING_COPY.postalCode]) await userEvent.type(screen.getByLabelText(label), 'x');
    expect(screen.queryByLabelText(BILLING_COPY.trialChoice(14))).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: BILLING_COPY.continueToStripe }));
    expect(await screen.findByText('Check the VAT number.')).toBeInTheDocument();
    expect(go).not.toHaveBeenCalled();
  });

  it('finishes the subscription when the owner comes back from Stripe', async () => {
    window.history.replaceState(null, '', '/b/crown/billing?checkout=done&session_id=cs_test_9');
    const api = mount(<BillingPage />, {
      'GET /business/billing': summary(),
      'POST /business/billing/checkout/complete': { subscribed: true, status: 'trialing' },
    });
    expect(await screen.findByText(BILLING_COPY.finished)).toBeInTheDocument();
    const [, init] = api.mock.calls.find(([path]) => path === '/business/billing/checkout/complete')!;
    expect(JSON.parse(String(init?.body))).toEqual({ session_id: 'cs_test_9' });
    expect(window.location.search).toBe('');
  });

  it('says business plans are not on sale while selling is off', async () => {
    mount(<BillingPage />, { 'GET /business/billing': { ...summary(), checkout: { ...summary().checkout, selling: false } } });
    expect(await screen.findByText(BILLING_COPY.checkoutOff)).toBeInTheDocument();
  });
});

describe('play-log export', () => {
  it('downloads one venue for the chosen days', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:log'), revokeObjectURL: vi.fn() });
    const api = mount(<PlayLogExport />, {
      'GET /business/play-log/export?venue_id=camden&from=2026-11-01&to=2026-11-07': { filename: 'selectadj-play-log-camden.csv', csv: 'started_at_utc\n' },
    }, { features: { ...org().features, 'business.licensing': true } });
    await userEvent.type(screen.getByLabelText(EXPORT_COPY.from), '2026-11-01');
    await userEvent.type(screen.getByLabelText(EXPORT_COPY.to), '2026-11-07');
    await userEvent.click(screen.getByRole('button', { name: EXPORT_COPY.start }));
    expect(await screen.findByText(EXPORT_COPY.ready('selectadj-play-log-camden.csv'))).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/business/play-log/export?venue_id=camden&from=2026-11-01&to=2026-11-07', undefined, 'ws-crown');
  });

  it('refuses backwards dates and hides itself when licensing is off', async () => {
    mount(<PlayLogExport />, {}, { features: { ...org().features, 'business.licensing': true } });
    await userEvent.type(screen.getByLabelText(EXPORT_COPY.from), '2026-11-07');
    await userEvent.type(screen.getByLabelText(EXPORT_COPY.to), '2026-11-01');
    await userEvent.click(screen.getByRole('button', { name: EXPORT_COPY.start }));
    expect(screen.getByText(EXPORT_COPY.backwards)).toBeInTheDocument();
  });

  it('is not drawn when business.licensing is off', () => {
    mount(<PlayLogExport />, {}, { features: { ...org().features, 'business.licensing': false } });
    expect(screen.queryByText(EXPORT_COPY.title)).toBeNull();
  });
});
