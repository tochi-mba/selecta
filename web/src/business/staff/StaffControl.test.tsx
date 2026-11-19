import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessContext, type BusinessCtx } from '../context';
import { NOW, org, venue, zone } from '../fixtures';
import type { Org, Venue } from '../types';
import { StaffControl } from './StaffControl';

function renderControl({ venues = [venue('camden', 'Camden')], theOrg = org(), loading = false }: { venues?: Venue[]; theOrg?: Org; loading?: boolean } = {}) {
  const client = {
    requests: vi.fn(async () => []),
    command: vi.fn(async () => ({ id: 'c1', accepted: true })),
    stayOpenLate: vi.fn(async () => venues[0]),
    checkPin: vi.fn(async () => ({ ok: true })),
    decide: vi.fn(async () => null),
  };
  const refresh = vi.fn(async () => {});
  const ctx = {
    org: theOrg, venues, devices: [], activity: [], client, now: NOW, offline: false, updatedAt: NOW,
    health: 'ok', loading, readOnly: false, refresh, go: vi.fn(),
  } as unknown as BusinessCtx;
  render(<BusinessContext.Provider value={ctx}><StaffControl venueId="camden" /></BusinessContext.Provider>);
  return { client, refresh };
}

afterEach(() => { localStorage.clear(); });

describe('StaffControl wiring (ADR-0453 D4, D10)', () => {
  it('offers Stay open late within the allowance and sends it', async () => {
    const { client, refresh } = renderControl();
    fireEvent.click(screen.getByRole('button', { name: /^Keep the music on until/ }));
    await waitFor(() => expect(client.stayOpenLate).toHaveBeenCalledWith('crown', 'camden', 60));
    expect(refresh).toHaveBeenCalled();
  });

  it('says the music is staying on once late hours are running', () => {
    renderControl({ venues: [venue('camden', 'Camden', { stay_open_late: { allowance_minutes: 60, until: NOW + 1800 } })] });
    expect(screen.getByText(/^Music stays on until/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Keep the music on/ })).toBeNull();
  });

  it('shows the one manager line only to a manager', () => {
    const grace = org({ billing: { ...org().billing, status: 'grace', grace_ends_at: NOW + 3600 } });
    renderControl({ theOrg: grace });
    expect(screen.getByText('The music will stop at closing time tonight. Your owner knows why')).toBeInTheDocument();
  });

  it('never shows the manager line to staff', () => {
    renderControl({ theOrg: org({ role: 'staff', billing: { ...org().billing, status: 'grace', grace_ends_at: NOW + 3600 } }) });
    expect(screen.queryByText(/Your owner knows why/)).toBeNull();
  });

  it('asks before a paired tablet plays a silent zone here, then sends play_here', async () => {
    localStorage.setItem('selecta.device.ws-crown', 'tablet-1');
    const silent = venue('camden', 'Camden', { zones: [zone('camden', 'camden-bar', 'Bar', { state: 'silent', state_since: NOW - 300, now: null })] });
    const { client } = renderControl({ venues: [silent] });
    fireEvent.click(screen.getByRole('button', { name: 'Play here instead' }));
    expect(screen.getByText('Play Bar music from this tablet? The Bar player will stop.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play here' }));
    await waitFor(() => expect(client.command).toHaveBeenCalledWith('camden-bar', { kind: 'play_here', device_id: 'tablet-1' }, expect.any(String)));
  });

  it('shows skeletons, not "unavailable", while the venue is still loading', () => {
    renderControl({ venues: [], loading: true });
    expect(screen.getByTestId('deck-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('This venue is unavailable.')).toBeNull();
  });
});
