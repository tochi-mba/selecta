// The host's room panel shows who is really here (ADR-0416): guests "Here now" or "Away · last
// seen", screens "showing now" or "offline since", updated by the 3 s poll with no refresh, and
// changes announced politely at most once every 10 s. The owner saw the panel keep saying
// "Guests (1)" and "1 screen paired" after the server restarted with nobody connected.
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ago, groupGuests, guestsHeading, presenceChanges, screenPresence } from './presence';
import { RoomPanel } from './RoomPanel';

const NOW = 1_800_000_000;
type Answer = Record<string, unknown>;

function panel(over: Answer = {}): Answer {
  return {
    room: { id: 'room-1', name: 'Garden party', status: 'open', ends_at: NOW + 3600, settings: { join_mode: 'anyone', request_mode: 'auto', votes: true, names_shown: false, display: true } },
    code: 'ABCD-EFGH', join_path: '/r/ABCDEFGH', inbox: [], coming_up: [], unfit: [], renders_left: 10, music_paused: false,
    guests: [], displays: 0, screens: [], now: NOW, ...over,
  };
}
const guest = (id: string, nickname: string, online: boolean, seenAgo: number, status = 'active') => ({ id, nickname, status, joined_at: NOW - 7200, last_seen_at: NOW - seenAgo, online });
const tv = (id: string, label: string, online: boolean, lastSeen: number | null) => ({ id, label, paired_at: NOW - 600, last_seen_at: lastSeen, online });

let current: Answer;
let calls: { path: string; method: string }[];

function mount() {
  const api = vi.fn(async (path: string, init: RequestInit = {}) => {
    calls.push({ path, method: init.method ?? 'GET' });
    if (path === '/rooms/current') return { room: current };
    return current;
  }) as never;
  return render(<RoomPanel api={api} workspaceId="ws-1" origin="https://app.test" />);
}
async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // the announcement, if due now
}

beforeEach(() => { vi.useFakeTimers(); calls = []; });
afterEach(() => { vi.useRealTimers(); });

describe('room panel presence', () => {
  it('says who is here and who is away, and counts only those here', async () => {
    current = panel({ guests: [guest('g1', 'Creative Lemur', true, 2), guest('g2', 'Quiet Otter', false, 5 * 60)] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('room-guests-heading')).toHaveTextContent('Guests (1 here, 1 away)');
    const rows = screen.getAllByTestId('room-guest');
    expect(rows[0]).toHaveTextContent('Creative Lemur · Here now');
    expect(rows[1]).toHaveTextContent('Quiet Otter · Away · last seen 5 min ago');
  });

  it('puts guests gone longer than 30 minutes in a collapsed group', async () => {
    current = panel({ guests: [guest('g1', 'Creative Lemur', false, 45 * 60)] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const gone = screen.getByTestId('room-guests-gone');
    expect(gone.tagName).toBe('DETAILS');
    expect(gone).not.toHaveAttribute('open');
    expect(within(gone).getByText('Left or away (1)')).toBeInTheDocument();
    expect(screen.getByTestId('room-guests-heading')).toHaveTextContent('Guests (0 here, 1 away)');
  });

  it('shows each screen online or offline with its own Disconnect', async () => {
    const at = new Date(2026, 10, 12, 21, 4).getTime() / 1000;
    current = panel({ displays: 2, screens: [tv('d1', 'Screen 1', true, NOW - 2), tv('d2', 'Screen 2', false, at)] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const rows = screen.getAllByTestId('room-screen');
    expect(rows[0]).toHaveTextContent('Screen 1 · showing now');
    expect(rows[1]).toHaveTextContent('Screen 2 · offline since 21:04');
    await act(async () => { screen.getByRole('button', { name: 'Disconnect Screen 2' }).click(); await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toContainEqual({ path: '/rooms/room-1/displays/d2', method: 'DELETE' });
    expect(screen.getByRole('button', { name: 'Disconnect screens' })).toBeInTheDocument();
  });

  it('updates on the next poll with no refresh, and says so politely', async () => {
    current = panel({ guests: [guest('g1', 'Creative Lemur', true, 2)], displays: 1, screens: [tv('d1', 'Screen 1', true, NOW - 2)] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('room-guests-heading')).toHaveTextContent('Guests (1 here)');

    // the server restarts: its first answer says nobody has checked in since
    current = panel({ guests: [guest('g1', 'Creative Lemur', false, 40)], displays: 1, screens: [tv('d1', 'Screen 1', false, NOW - 40)], now: NOW + 3 });
    await poll();
    expect(screen.getByTestId('room-guests-heading')).toHaveTextContent('Guests (0 here, 1 away)');
    expect(screen.getByTestId('room-screen')).toHaveTextContent('offline since');
    const said = screen.getByTestId('room-presence-said');
    expect(said).toHaveAttribute('aria-live', 'polite');
    expect(said).toHaveTextContent('Creative Lemur is away. Screen 1 went offline.');

    // they reconnect three seconds later: announced, but not before 10 s since the last one
    current = panel({ guests: [guest('g1', 'Creative Lemur', true, 1)], displays: 1, screens: [tv('d1', 'Screen 1', true, NOW + 5)], now: NOW + 6 });
    await poll();
    expect(screen.getByTestId('room-guest')).toHaveTextContent('Here now');
    expect(said).toHaveTextContent('Creative Lemur is away.');
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    expect(said).toHaveTextContent('Creative Lemur is back. Screen 1 is showing again.');
  });

  it('drops a guest who left and a screen that disconnected', async () => {
    current = panel({ guests: [guest('g1', 'Creative Lemur', true, 2)], displays: 1, screens: [tv('d1', 'Screen 1', true, NOW - 2)] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    current = panel({ guests: [guest('g1', 'Creative Lemur', false, 3, 'removed')], displays: 0, screens: [] });
    await poll();
    expect(screen.queryByTestId('room-guest')).toBeNull();
    expect(screen.queryByTestId('room-screen')).toBeNull();
    expect(screen.getByText(/No guests yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect screens' })).toBeNull();
  });
});

describe('presence words', () => {
  it('reads times plainly', () => {
    expect(ago(10)).toBe('just now');
    expect(ago(5 * 60 + 20)).toBe('5 min ago');
    expect(ago(3 * 3600)).toBe('3 h ago');
    expect(screenPresence(tv('d', 'Screen 1', false, null))).toBe('Screen 1 · offline, not seen yet');
  });

  it('groups and counts only guests still in the room', () => {
    const groups = groupGuests([guest('a', 'A', true, 1), guest('b', 'B', false, 120), guest('c', 'C', false, 3600), guest('d', 'D', true, 1, 'banned')], NOW);
    expect(groups.here.map((g) => g.id)).toEqual(['a']);
    expect(groups.away.map((g) => g.id)).toEqual(['b']);
    expect(groups.gone.map((g) => g.id)).toEqual(['c']);
    expect(guestsHeading(groups)).toBe('Guests (1 here, 2 away)');
    expect(guestsHeading(groupGuests([], NOW))).toBe('Guests (0)');
  });

  it('says nothing on the first look', () => {
    expect(presenceChanges(null, { guests: [guest('a', 'A', true, 1)], screens: [] })).toEqual([]);
  });
});
