import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevicesPanel, seen } from './DevicesPanel';
import type { Api } from './usePlaybackDevice';
import { clearToasts, Toaster } from '../ui/toasts';
import devicesSource from './DevicesPanel.tsx?raw';
import playingSource from './PlayingBar.tsx?raw';
import roomSource from '../rooms/RoomPanel.tsx?raw';

// W3: Account > Devices reads its list only while the tab is on screen, signing a device out asks
// "Sign out <name>?" first, and last seen reads in the reader's language.

const NOW = 1_800_000_000;
const device = (id: string, name: string, lastSeen: number) => ({ id, name, kind: 'laptop', signed_in: true, this_device: false, poor_speaker: false, last_seen_at: lastSeen, warnings: [] });
let calls: { path: string; method: string }[];

function mount() {
  const api = (async (path: string, init: RequestInit = {}) => {
    calls.push({ path, method: init.method ?? 'GET' });
    if (path.startsWith('/devices?') || path === '/devices') return { devices: [device('d1', 'Old laptop', NOW - 3 * 3600)], limit: 10 };
    return {};
  }) as Api;
  return render(<><DevicesPanel api={api} workspaceId="ws-1" /><Toaster /></>);
}
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW * 1000); calls = []; });
afterEach(() => { cleanup(); clearToasts(); vi.useRealTimers(); });

describe('devices panel', () => {
  it('asks before signing a device out, and only then sends it', async () => {
    mount();
    await settle();
    await act(async () => { screen.getByRole('button', { name: 'Sign out this device: Old laptop' }).click(); await vi.advanceTimersByTimeAsync(0); });
    const dialog = screen.getByRole('alertdialog', { name: 'Sign out Old laptop?' });
    expect(dialog).toHaveTextContent('It stops playing and leaves your account. It can sign in again any time.');
    expect(dialog).not.toHaveTextContent(/forget|paired/i);
    expect(calls.some((call) => call.path.endsWith('/sign-out'))).toBe(false);
    await act(async () => { within(dialog).getByRole('button', { name: 'Sign out this device' }).click(); await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toContainEqual({ path: '/devices/d1/sign-out', method: 'POST' });
    expect(screen.getByText('Old laptop was signed out.')).toBeInTheDocument();
  });

  it('pauses its reads while the tab is hidden', async () => {
    mount();
    await settle();
    // one read of the devices list per look (the holdings read beside it is counted apart)
    const reads = () => calls.filter((call) => call.method === 'GET' && call.path.startsWith('/devices')).length;
    const before = reads();
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(reads()).toBe(before);
    hidden.mockReturnValue('visible');
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(reads()).toBe(before + 1);
    hidden.mockRestore();
  });

  it('says when a device was last seen', () => {
    expect(seen(NOW - 30, NOW)).toBe('Active now');
    // jsdom reads as en-US, so Intl says it in English
    expect(seen(NOW - 5 * 60, NOW)).toBe('Last active 5 minutes ago');
    expect(seen(NOW - 3 * 3600, NOW)).toBe('Last active 3 hours ago');
  });
});

describe('busy labels (L3)', () => {
  it('end in the ellipsis character, never three dots', () => {
    for (const source of [devicesSource, playingSource, roomSource]) {
      expect(source).not.toMatch(/working=["{`][^"}`]*\.\.\./);
      expect(source).not.toMatch(/'[A-Z][a-z ]+\.\.\.'/);
    }
    expect(devicesSource).toContain('`Signing out${ELLIPSIS}`');
    expect(playingSource).toContain('`Moving${ELLIPSIS}`');
    expect(roomSource).toContain('`Pairing${ELLIPSIS}`');
  });
});

describe('the default speaker (ADR-0475)', () => {
  it('marks the default, offers it only for a device with music, and sends the choice', async () => {
    let chosen: string | null = 'd1';
    const sent: unknown[] = [];
    const api = (async (path: string, init: RequestInit = {}) => {
      if (path === '/devices/default-speaker') { sent.push(JSON.parse(String(init.body))); chosen = (sent.at(-1) as { device_id: string | null }).device_id; return { default_speaker_id: chosen }; }
      if (path.startsWith('/devices')) return { devices: [device('d1', 'Laptop', NOW - 10), device('d2', 'Phone', NOW - 10), device('d3', 'Tablet', NOW - 10)], limit: 10, default_speaker_id: chosen };
      if (path === '/local-media/holdings') return { devices: [{ device_id: 'd1', songs: 0 }, { device_id: 'd2', songs: 4 }, { device_id: 'd3', songs: 0 }] };
      return {};
    }) as Api;
    render(<><DevicesPanel api={api} workspaceId="ws-1" /><Toaster /></>);
    await settle();
    // the default whose music was removed stays the default, and says so
    expect(screen.getByTestId('default-speaker')).toHaveTextContent('Default speaker, no music connected');
    expect(screen.queryByRole('button', { name: 'Make Tablet the default speaker' })).toBeNull();
    await act(async () => { screen.getByRole('button', { name: 'Make Phone the default speaker' }).click(); await vi.advanceTimersByTimeAsync(0); });
    expect(sent).toEqual([{ device_id: 'd2' }]);
    expect(screen.getByText('Phone is your default speaker. Used the next time nothing is playing.')).toBeInTheDocument();
  });
});
