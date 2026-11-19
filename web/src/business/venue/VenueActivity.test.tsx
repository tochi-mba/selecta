// The venue page's activity log reads `GET /api/business/venues/{id}/activity` through the typed
// business routes (ADR-0452 BZ-0452-12), and settings and the library speak from the copy deck.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { businessApi } from '../api';
import { BusinessContext, type BusinessCtx } from '../context';
import { LIBRARY_COPY, SETTINGS_COPY } from '../copy/shell';
import { VENUE_COPY } from '../copy/venue';
import { NOW, org, venue } from '../fixtures';
import { OrgLibrary } from '../library/OrgLibrary';
import { licenceWords, SettingsPage } from '../settings/SettingsPage';
import { VenueActivity } from './VenueActivity';

const line = { id: 'a9', at: NOW - 60, venue_id: 'camden', zone_id: 'camden-bar', kind: 'request.approved', words: 'Approved a request for Slow Tide' };

function ctx(extra: Partial<BusinessCtx> = {}): BusinessCtx {
  return {
    org: org(), venues: [venue('camden', 'Camden')], devices: [], activity: [], client: {} as BusinessCtx['client'],
    now: NOW, offline: false, updatedAt: NOW, health: { stream: 'live' }, loading: false, readOnly: false,
    refresh: async () => {}, go: vi.fn(), ...extra,
  } as BusinessCtx;
}

describe('venue activity', () => {
  it('reads the venue activity route in the organisation workspace', async () => {
    const api = vi.fn(async () => ({ activity: [line] }));
    const bizApi = businessApi(api as unknown as Api, 'ws-crown');
    render(<BusinessContext.Provider value={ctx({ bizApi })}><VenueActivity venueId="camden" /></BusinessContext.Provider>);
    expect(await screen.findByText(/Approved a request for Slow Tide/)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/business/venues/camden/activity', {}, 'ws-crown');
  });

  it('says so when nothing happened, and offers a retry when the read fails', async () => {
    let fail = true;
    const api = vi.fn(async () => { if (fail) throw new Error('down'); return { activity: [] }; });
    const bizApi = businessApi(api as unknown as Api, 'ws-crown');
    render(<BusinessContext.Provider value={ctx({ bizApi })}><VenueActivity venueId="camden" /></BusinessContext.Provider>);
    expect(await screen.findByRole('alert')).toHaveTextContent(VENUE_COPY.activityFailed);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: VENUE_COPY.activityRetry }));
    expect(await screen.findByText(VENUE_COPY.activityEmpty)).toBeInTheDocument();
  });

  it('falls back to the overview lines for this venue without the typed routes', async () => {
    const activity = [{ ...line, id: 'x1', words: 'Here' }, { ...line, id: 'x2', venue_id: 'soho', words: 'Elsewhere' }];
    render(<BusinessContext.Provider value={ctx({ activity })}><VenueActivity venueId="camden" /></BusinessContext.Provider>);
    expect(await screen.findByText(/Here/)).toBeInTheDocument();
    expect(screen.queryByText(/Elsewhere/)).toBeNull();
  });
});

describe('settings and library copy', () => {
  it('lists each venue licence in words and links to its licence and rules', async () => {
    const go = vi.fn();
    const venues = [
      venue('camden', 'Camden'),
      venue('soho', 'Soho', { licence: null }),
      venue('leeds', 'Leeds', { licence: { kind: 'themusiclicence', number: 'T1', expires_on: '2026-11-20', attested_at: NOW } }),
    ];
    render(<BusinessContext.Provider value={ctx({ venues, go })}><SettingsPage /></BusinessContext.Provider>);
    expect(screen.getByRole('heading', { name: SETTINGS_COPY.title })).toBeInTheDocument();
    expect(screen.getByText(/Soho: No licence yet/)).toBeInTheDocument();
    expect(licenceWords(venues[0], NOW)).toMatch(/^Valid until /);
    expect(licenceWords(venues[2], NOW)).toMatch(/^Ends on /);
    expect(licenceWords(venue('old', 'Old', { licence: { kind: 'other', number: 'O', expires_on: '2026-01-01', attested_at: NOW } }), NOW)).toMatch(/^Date passed on /);
    await userEvent.click(screen.getByRole('button', { name: SETTINGS_COPY.openLicence('Soho') }));
    expect(go).toHaveBeenCalledWith('/b/crown/v/soho/licence');
    await userEvent.click(screen.getByRole('button', { name: SETTINGS_COPY.openRules('Camden') }));
    expect(go).toHaveBeenCalledWith('/b/crown/v/camden/rules');
  });

  it('reflows the licence and rules sections when there are no venues', () => {
    render(<BusinessContext.Provider value={ctx({ venues: [] })}><SettingsPage /></BusinessContext.Provider>);
    expect(screen.getByText(SETTINGS_COPY.noVenues)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: SETTINGS_COPY.rulesHeading })).toBeNull();
  });

  it('names the organisation library from the copy deck', async () => {
    const client = { librarySongs: vi.fn(async () => []) } as unknown as BusinessCtx['client'];
    render(<BusinessContext.Provider value={ctx({ client })}><OrgLibrary /></BusinessContext.Provider>);
    expect(screen.getByRole('heading', { name: LIBRARY_COPY.title('The Crown Group') })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(LIBRARY_COPY.empty)).toBeInTheDocument());
  });
});
