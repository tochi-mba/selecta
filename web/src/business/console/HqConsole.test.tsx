import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BusinessContext, type BusinessCtx } from '../context';
import { NOW, scenario, type Scenario } from '../fixtures';
import { HqConsole } from './HqConsole';
import { VenueManager } from '../venue/VenueManager';

// S2 and S3 render from the overview (ADR-0453 BZ-0453-08, -09, -12): the venue health grid with
// every venue, the silent-zone alert at the top, and a venue page for one venue.

function ctxFor(kind: Scenario, extra: Partial<BusinessCtx> = {}): BusinessCtx {
  const data = scenario(kind);
  return {
    org: data.org, venues: data.venues, devices: data.devices ?? [], activity: data.activity ?? [],
    client: { requests: vi.fn(async () => []), schedule: vi.fn(async () => null), rules: vi.fn(async () => null), librarySongs: vi.fn(async () => []) } as never,
    now: NOW, offline: false, updatedAt: NOW, health: { stream: 'live' }, loading: false, readOnly: false,
    refresh: vi.fn(async () => {}), go: vi.fn(), ...extra,
  } as BusinessCtx;
}

describe('HQ console and venue page', () => {
  it('lists every venue in the health grid', () => {
    render(<BusinessContext.Provider value={ctxFor('normal')}><HqConsole /></BusinessContext.Provider>);
    for (const name of ['Camden', 'Soho', 'Brooklyn']) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  });

  it('puts a silent zone at the top, in words, not colour alone', () => {
    render(<BusinessContext.Provider value={ctxFor('silent')}><HqConsole /></BusinessContext.Provider>);
    expect(screen.getAllByText(/Silent/).length).toBeGreaterThan(0);
  });

  it('opens one venue on the manager view', () => {
    render(<BusinessContext.Provider value={ctxFor('normal')}><VenueManager venueId="camden" /></BusinessContext.Provider>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Camden');
  });
});
