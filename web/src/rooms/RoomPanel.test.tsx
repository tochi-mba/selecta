// The host's room panel shows who is really here (ADR-0416): guests "Here now" or "Away · last
// seen", screens "showing now" or "offline since", updated by the 3 s poll with no refresh, and
// changes announced politely at most once every 10 s. The owner saw the panel keep saying
// "Guests (1)" and "1 screen paired" after the server restarted with nobody connected.
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ago, groupGuests, guestsHeading, presenceChanges, screenPresence } from './presence';
import { RoomPanel } from './RoomPanel';
import { clearToasts, Toaster } from '../ui/toasts';

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

function mount(locked?: string) {
  const api = vi.fn(async (path: string, init: RequestInit = {}) => {
    calls.push({ path, method: init.method ?? 'GET' });
    if (path === '/rooms/current') return { room: current };
    return current;
  }) as never;
  return render(<><RoomPanel api={api} workspaceId="ws-1" origin="https://app.test" locked={locked} /><Toaster /></>);
}
// the Guests card heads its list with "N here" and, when anyone is away, "· N away"
const guestCount = () => screen.getByTestId('room-guests-heading').nextElementSibling as HTMLElement;
/** What the count says. A rolling number also draws strips of digits for the eye only
 * (feel/numberRoll, aria-hidden), which are not part of the words. */
const countSays = () => {
  const copy = guestCount().cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent ?? '';
};
async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // the announcement, if due now
}

beforeEach(() => { vi.useFakeTimers(); calls = []; });
afterEach(() => { clearToasts(); vi.useRealTimers(); });

describe('room panel presence', () => {
  it('says who is here and who is away, and counts only those here', async () => {
    current = panel({ guests: [guest('g1', 'Creative Lemur', true, 2), guest('g2', 'Quiet Otter', false, 5 * 60)] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(countSays()).toMatch(/^1 here · 1 away$/);
    const rows = screen.getAllByTestId('room-guest');
    expect(rows[0]).toHaveTextContent('Creative Lemur');
    expect(within(rows[0]).getByTestId('room-guest-presence')).toHaveTextContent('Here now');
    expect(rows[1]).toHaveTextContent('Quiet Otter');
    expect(within(rows[1]).getByTestId('room-guest-presence')).toHaveTextContent('Away · last seen 5 min ago');
  });

  it('puts guests gone longer than 30 minutes in a collapsed group', async () => {
    current = panel({ guests: [guest('g1', 'Creative Lemur', false, 45 * 60)] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const gone = screen.getByTestId('room-guests-gone');
    expect(gone.tagName).toBe('DETAILS');
    expect(gone).not.toHaveAttribute('open');
    expect(within(gone).getByText('Away for a while (1)')).toBeInTheDocument();
    expect(countSays()).toMatch(/^0 here · 1 away$/);
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
    expect(screen.getByRole('button', { name: 'Disconnect all screens' })).toBeInTheDocument();
  });

  it('updates on the next poll with no refresh, and says so politely', async () => {
    current = panel({ guests: [guest('g1', 'Creative Lemur', true, 2)], displays: 1, screens: [tv('d1', 'Screen 1', true, NOW - 2)] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(countSays()).toMatch(/^1 here$/);

    // the server restarts: its first answer says nobody has checked in since
    current = panel({ guests: [guest('g1', 'Creative Lemur', false, 40)], displays: 1, screens: [tv('d1', 'Screen 1', false, NOW - 40)], now: NOW + 3 });
    await poll();
    expect(countSays()).toMatch(/^0 here · 1 away$/);
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
    expect(screen.queryByRole('button', { name: 'Disconnect all screens' })).toBeNull();
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

// W3: the host's buttons are Actions; Remove, Ban and a new code ask first; ending the room says so
// on the panel it comes back to; the poll pauses in a hidden tab.
describe('room panel actions', () => {
  const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
  const press = async (name: string) => { await act(async () => { screen.getByRole('button', { name }).click(); await vi.advanceTimersByTimeAsync(0); }); };
  // a new code and closing the room live in the header's Room options menu
  const roomOption = async (name: string) => {
    await press('Room options');
    await act(async () => { screen.getByRole('menuitem', { name }).click(); await vi.advanceTimersByTimeAsync(0); });
  };

  it('asks before removing a guest, and sends nothing when the host keeps them', async () => {
    current = panel({ guests: [guest('g1', 'Creative Lemur', true, 2)] });
    mount();
    await settle();
    await press('Options for Creative Lemur');
    await act(async () => { screen.getByRole('menuitem', { name: 'Remove Creative Lemur' }).click(); await vi.advanceTimersByTimeAsync(0); });
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Creative Lemur?' });
    expect(dialog).toHaveTextContent('They can scan the code again and join as someone new');
    expect(calls.some((call) => call.path.endsWith('/remove'))).toBe(false);
    await act(async () => { within(dialog).getByRole('button', { name: 'Keep it' }).click(); await vi.advanceTimersByTimeAsync(400); });
    expect(calls.some((call) => call.path.endsWith('/remove'))).toBe(false);

    await press('Options for Creative Lemur');
    await act(async () => { screen.getByRole('menuitem', { name: 'Ban Creative Lemur' }).click(); await vi.advanceTimersByTimeAsync(0); });
    const ban = screen.getByRole('alertdialog', { name: 'Ban Creative Lemur?' });
    expect(ban).toHaveTextContent('This can’t be undone.');
    await act(async () => { within(ban).getByRole('button', { name: 'Ban' }).click(); await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toContainEqual({ path: '/rooms/room-1/guests/g1/ban', method: 'POST' });
  });

  it('says the old QR code stops working before making a new code', async () => {
    current = panel();
    mount();
    await settle();
    await roomOption('Make a new code');
    const dialog = screen.getByRole('alertdialog', { name: 'Make a new code?' });
    expect(dialog).toHaveTextContent('The old QR code stops working the moment the new one exists.');
    await act(async () => { within(dialog).getByRole('button', { name: 'Make a new code' }).click(); await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toContainEqual({ path: '/rooms/room-1/code', method: 'POST' });
    expect(screen.getByText('New code made. The old one no longer works.')).toBeInTheDocument();
  });

  it('says the room closed on the panel it comes back to', async () => {
    current = panel();
    mount();
    await settle();
    await roomOption('Close room');
    current = panel({ room: { ...(panel().room as object), status: 'ended' } });
    await act(async () => { within(screen.getByRole('alertdialog', { name: 'Close Garden party?' })).getByRole('button', { name: 'Close room' }).click(); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('heading', { name: 'Let your guests pick the music' })).toBeInTheDocument();
    expect(screen.getByText('Garden party is closed.')).toBeInTheDocument();
  });

  it('counts votes with the right word, and says nothing for the asker’s own vote', async () => {
    const ask = (id: string, title: string, votes: number) => ({ request_id: id, song: { song_id: Number(id.slice(1)), title, artist: 'Band', length_s: 200 }, status: 'sent', votes, nickname: 'Fox' });
    current = panel({ inbox: [ask('q1', 'Tune', 1), ask('q2', 'Other tune', 2)] });
    mount();
    await settle();
    const [one, two] = screen.getAllByTestId('room-ask');
    expect(one).not.toHaveTextContent(/vote/);
    expect(within(two).getByText('2 votes')).toHaveClass('ask-extra');
  });

  it('stops reading the room while the tab is hidden and reads at once on return', async () => {
    current = panel();
    mount();
    await settle();
    const reads = () => calls.filter((call) => call.path === '/rooms/current').length;
    const before = reads();
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(reads()).toBe(before);
    hidden.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
    expect(reads()).toBe(before + 1);
    hidden.mockRestore();
  });
});

describe('a host who downgraded mid-party', () => {
  it('keeps the open room, says why no new one can open, and shows the offer only once it ends', async () => {
    current = panel();
    mount('premium');
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('heading', { name: 'Garden party' })).toBeInTheDocument();
    expect(screen.getByTestId('room-after-downgrade')).toHaveTextContent('Your plan no longer includes Rooms. This room stays open until it ends; opening a new one needs Premium.');
    current = null as unknown as Answer;
    await poll();
    expect(screen.getByText(/Rooms are part of Premium/)).toBeInTheDocument();
  });
});
