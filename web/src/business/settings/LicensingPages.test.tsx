// ADR-0449 in the page: an organisation upload confirms the rights statement for its batch, the
// changed business terms hold management (never playback), the licence guide and ISRC coverage.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { attestationAsked, UploadsPanel } from '../../cloud/Uploads';
import { businessClient } from '../client';
import { BusinessContext, type BusinessCtx } from '../context';
import { EXPORT_COPY, LICENCE_GUIDE } from '../copy/console';
import { NOW, org, venue } from '../fixtures';
import { LicenceGuide } from '../forms/LicenceGuide';
import { TermsGate } from './LicensingCards';
import { IsrcCoverage } from './PlayLogExport';

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

const terms = (accepted: boolean) => ({ current_version: 'v2', accepted, management_blocked: !accepted, playback_allowed: true, terms_path: '/business/terms', can_accept: true });

describe('upload rights', () => {
  it('reads the statement from a refused plan', () => {
    const refused = Object.assign(new Error('no'), { code: 'upload_attestation_required', payload: { detail: { code: 'upload_attestation_required', statement: 'I confirm', statement_version: 's1' } } });
    expect(attestationAsked(refused)).toEqual({ statement: 'I confirm', statement_version: 's1' });
    expect(attestationAsked(new Error('other'))).toBeNull();
  });

  it('asks for the statement, attests the batch and plans again naming it', async () => {
    let planned = 0;
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/uploads') return { uploads: [] };
      if (path === '/uploads/plan') {
        planned += 1;
        if (planned === 1) throw Object.assign(new Error('Confirm the rights'), { code: 'upload_attestation_required', payload: { detail: { code: 'upload_attestation_required', statement: 'I confirm this business holds the rights.', statement_version: 's1' } } });
        return { uploads: [] };
      }
      if (path === '/business/uploads/attestation') return { batch_id: 'batch-1' };
      throw new Error(`unexpected ${path} ${init?.method}`);
    });
    render(<UploadsPanel api={api as unknown as Api} workspaceId="ws-crown" setError={() => {}} setNotice={() => {}} blocked={null} />);
    await userEvent.upload(document.querySelector('input[type=file]') as HTMLInputElement, new File(['abc'], 'song.mp3', { type: 'audio/mpeg' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    expect(await screen.findByText('I confirm this business holds the rights.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I confirm' }));
    await waitFor(() => expect(planned).toBe(2));
    const attest = api.mock.calls.find(([path]) => path === '/business/uploads/attestation')!;
    expect(JSON.parse(String(attest[1]?.body))).toEqual({ file_count: 1, statement_version: 's1', attested: true });
    const second = api.mock.calls.filter(([path]) => path === '/uploads/plan')[1];
    expect(second[1]?.headers).toEqual({ 'X-Upload-Batch': 'batch-1' });
  });
});

describe('licensing pages', () => {
  it('holds management until the changed terms are accepted', async () => {
    mount(<TermsGate><p>Venues page</p></TermsGate>, { 'GET /business/terms': terms(false), 'POST /business/terms/accept': terms(true) });
    expect(await screen.findByRole('button', { name: EXPORT_COPY.termsAccept })).toBeInTheDocument();
    expect(screen.queryByText('Venues page')).toBeNull();
  });

  it('never holds the staff control page', () => {
    mount(<TermsGate skip><p>Control</p></TermsGate>, {});
    expect(screen.getByText('Control')).toBeInTheDocument();
  });

  it('explains each territory with the bodies own sites', async () => {
    render(<LicenceGuide />);
    await userEvent.click(screen.getByText(LICENCE_GUIDE.summary));
    expect(screen.getByRole('link', { name: 'TheMusicLicence (PPL PRS)' })).toHaveAttribute('href', 'https://pplprs.co.uk/');
    expect(screen.getByRole('heading', { name: 'European Union' })).toBeInTheDocument();
  });

  it('shows how many songs played at a venue have an ISRC', async () => {
    mount(<IsrcCoverage venueId="camden" />, { 'GET /business/venues/camden/isrc-coverage': { tracks: 10, with_isrc: 7, share: 0.7 } });
    expect(await screen.findByText(EXPORT_COPY.coverage(7, 10))).toBeInTheDocument();
  });
});
