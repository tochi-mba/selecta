import { afterEach, describe, expect, it, vi } from 'vitest';

type Pending = { path: string; resolve: (value: unknown) => void };
const calls: Pending[] = [];

vi.mock('../rooms/dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('../rooms/dom')>();
  return {
    ...real,
    call: (path: string) => new Promise((resolve) => { calls.push({ path, resolve }); }),
  };
});

const song = { song_id: 7, title: 'Tune', artist: 'Band', length_s: 200 };
const room = (voted: boolean) => ({
  room_name: 'Party', room_status: 'open', guest_status: 'active', nickname: 'Fox',
  votes_on: true, requests_open: true, music_paused: false,
  now_playing: null, up_next: [], coming_up: [],
  waiting: [{ request_id: 'r1', song, status: 'sent', votes: voted ? 2 : 1, nickname: null, voted, mine: false }],
  my_requests: [],
});

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
const vote = () => document.querySelector<HTMLButtonElement>('.g-vote')!;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the guest page', () => {
  it('keeps a vote when a poll that left before it answers after it', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/r/VOTE2345');
    localStorage.setItem('selecta.guest.room.VOTE2345', 'room-2');
    document.body.innerHTML = '<main id="guest"></main>';
    await import('./main');
    calls.shift()!.resolve(room(false));
    await flush();
    expect(vote().getAttribute('aria-pressed')).toBe('false');

    // a poll goes out, then the guest votes, and the vote is answered first
    vi.advanceTimersByTime(5000);
    const poll = calls.shift()!;
    vote().click();
    const voted = calls.shift()!;
    expect(voted.path).toBe('/api/guest/rooms/room-2/requests/r1/vote');
    voted.resolve(room(true));
    await flush();
    expect(vote().getAttribute('aria-pressed')).toBe('true');

    poll.resolve(room(false));
    await flush();
    expect(vote().getAttribute('aria-pressed')).toBe('true');
    // and polling carries on
    vi.advanceTimersByTime(5000);
    expect(calls.map((pending) => pending.path)).toEqual(['/api/guest/rooms/room-2']);
  });
});
