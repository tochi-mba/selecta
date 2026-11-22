// Licensing settings call their routes (ADR-0449): retention (owner only), business terms and
// the owner's one-off licence grace extension.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { businessClient } from '../client';
import { BusinessContext, type BusinessCtx } from '../context';
import { EXPORT_COPY } from '../copy/console';
import { NOW, org, venue } from '../fixtures';
import type { Org } from '../types';
import { ExtendGrace, RetentionCard, TermsCard } from './LicensingCards';

function mount(node: ReactElement, answers: Record<string, unknown>, who: Partial<Org> = {}) {
  const api = vi.fn(async (path: string, init?: RequestInit) => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${path}`;
    if (key in answers) return answers[key];
    throw new Error(`unexpected ${key}`);
  });
  const ctx = {
    org: org({ features: { ...org().features, 'business.licensing': true }, ...who }), venues: [], devices: [], activity: [],
    client: businessClient(api as unknown as Api, 'ws-crown'), now: NOW, offline: false, updatedAt: NOW,
    health: { stream: 'live' }, loading: false, readOnly: false, refresh: async () => {}, go: vi.fn(),
  } as BusinessCtx;
  render(<BusinessContext.Provider value={ctx}>{node}</BusinessContext.Provider>);
  return api;
}

const terms = (accepted: boolean, canAccept = true) => ({ current_version: '2026-11-12', accepted, management_blocked: !accepted, playback_allowed: true, terms_path: '/business/terms', can_accept: canAccept });

describe('licensing settings', () => {
  it('lets the owner change how long play logs are kept', async () => {
    const api = mount(<RetentionCard />, {
      'GET /business/play-log/retention': { days: 1095, default_days: 1095 },
      'PUT /business/play-log/retention': { days: 2190 },
    });
    const field = await screen.findByLabelText(EXPORT_COPY.retentionLabel);
    await userEvent.clear(field);
    await userEvent.type(field, '2190');
    await userEvent.click(screen.getByRole('button', { name: EXPORT_COPY.retentionSave }));
    expect(await screen.findByText(EXPORT_COPY.retentionSaved(2190))).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/business/play-log/retention', expect.objectContaining({ body: JSON.stringify({ days: 2190 }) }), 'ws-crown');
  });

  it('shows retention read-only to an admin', async () => {
    mount(<RetentionCard />, { 'GET /business/play-log/retention': { days: 1095, default_days: 1095 } }, { role: 'admin' });
    expect(await screen.findByLabelText(EXPORT_COPY.retentionLabel)).toBeDisabled();
    expect(screen.queryByRole('button', { name: EXPORT_COPY.retentionSave })).toBeNull();
  });

  it('asks for the changed terms and records acceptance', async () => {
    mount(<TermsCard />, { 'GET /business/terms': terms(false), 'POST /business/terms/accept': terms(true) });
    await userEvent.click(await screen.findByRole('button', { name: EXPORT_COPY.termsAccept }));
    expect(await screen.findByText(EXPORT_COPY.termsAccepted('2026-11-12'))).toBeInTheDocument();
  });

  it('tells someone who cannot accept to ask', async () => {
    mount(<TermsCard />, { 'GET /business/terms': terms(false, false) }, { role: 'venue_manager' });
    expect(await screen.findByText(EXPORT_COPY.termsAskOwner)).toBeInTheDocument();
  });

  it('extends an expired licence once, for the owner only', async () => {
    const api = mount(<ExtendGrace venue={venue('camden', 'Camden')} />, {
      'POST /business/venues/camden/licence/extend': { extended_until: NOW + 14 * 86_400 },
    });
    await userEvent.type(screen.getByLabelText(EXPORT_COPY.extendReason), 'Renewal in the post');
    await userEvent.click(screen.getByRole('button', { name: EXPORT_COPY.extendButton }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/business/venues/camden/licence/extend', expect.objectContaining({ method: 'POST' }), 'ws-crown'));
  });
});
