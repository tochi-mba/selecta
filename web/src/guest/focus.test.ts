import { afterEach, describe, expect, it, vi } from 'vitest';

// W3: before the guest lists were patched in place, every 5 s poll rebuilt them and a guest on a
// Vote button lost focus to the page body (checked in jsdom before the fix). Now the button stays
// the same element, keeps focus and shows the new count.

type Pending = { path: string; resolve: (value: unknown) => void };
const calls: Pending[] = [];

vi.mock('../rooms/dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('../rooms/dom')>();
  return { ...real, call: (path: string) => new Promise((resolve) => { calls.push({ path, resolve }); }) };
});

const song = { song_id: 7, title: 'Tune', artist: 'Band', length_s: 200 };
const other = { song_id: 8, title: 'Other', artist: 'Band', length_s: 180 };
const room = (votes: number, extra: object[] = []) => ({
  room_name: 'Party', room_status: 'open', guest_status: 'active', nickname: 'Fox',
  votes_on: true, requests_open: true, music_paused: false, now_playing: null, up_next: [], coming_up: [],
  waiting: [...extra, { request_id: 'r1', song, status: 'sent', votes, nickname: null, voted: false, mine: false }], my_requests: [],
});
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('the guest page poll', () => {
  it('leaves focus on the Vote button the guest is on, and updates its count', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/r/FOCU2345');
    localStorage.setItem('selecta.guest.room.FOCU2345', 'room-2');
    document.body.innerHTML = '<main id="guest"></main>';
    await import('./main');
    calls.shift()!.resolve(room(1));
    await flush();
    const vote = document.querySelector<HTMLButtonElement>('[aria-label="Vote for Tune - Band"]')!;
    vote.focus();

    vi.advanceTimersByTime(5000);
    // a new request lands above it, so its row moves down
    calls.shift()!.resolve(room(3, [{ request_id: 'r0', song: other, status: 'sent', votes: 0, nickname: null, voted: false, mine: false }]));
    await flush();
    expect(document.activeElement).toBe(vote);
    expect(vote.isConnected).toBe(true);
    expect(vote.textContent).toContain('3');
  });
});
