// The guest page after the server stops and comes back (ADR-0416): it says "Reconnecting...",
// keeps the room on screen, backs off to at most 15 s, and is back in the room by itself with
// the same cookie. The owner's guest phone lost the room when the server restarted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../rooms/dom';

type Pending = { path: string; resolve: (value: unknown) => void; reject: (error: unknown) => void };
const calls: Pending[] = [];

vi.mock('../rooms/dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('../rooms/dom')>();
  return {
    ...real,
    call: (path: string) => new Promise((resolve, reject) => { calls.push({ path, resolve, reject }); }),
  };
});

const view = {
  room_name: 'Party', room_status: 'open', guest_status: 'active', nickname: 'Fox',
  votes_on: false, requests_open: true, music_paused: false,
  now_playing: null, up_next: [], coming_up: [], waiting: [], my_requests: [],
};
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
const notice = () => document.getElementById('g-notice')?.textContent;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the guest page', () => {
  it('reconnects by itself after the server comes back', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/r/WXYZ2345');
    localStorage.setItem('selecta.guest.room.WXYZ2345', 'room-9');
    document.body.innerHTML = '<main id="guest"></main>';
    await import('./main');
    calls.shift()!.resolve(view);
    await flush();
    expect(document.getElementById('g-shell')).not.toBeNull();

    // the server stops: three polls fail, each wait longer, never past 15 s
    for (const wait of [5000, 10_000, 15_000]) {
      vi.advanceTimersByTime(wait - 1);
      expect(calls).toHaveLength(0);
      vi.advanceTimersByTime(1);
      calls.shift()!.reject(new ApiError(0, 'offline', "Can't reach SelectaDJ. Check your signal."));
      await flush();
      expect(notice()).toBe('Reconnecting...');
      expect(document.getElementById('g-shell')).not.toBeNull();
    }
    vi.advanceTimersByTime(15_000);
    const back = calls.shift()!;
    expect(back.path).toBe('/api/guest/rooms/room-9');
    back.resolve(view);
    await flush();
    expect(notice()).toBe('Back in the room.');

    // and polls at the normal pace again, which is what tells the host they're here
    vi.advanceTimersByTime(5000);
    expect(calls.map((pending) => pending.path)).toEqual(['/api/guest/rooms/room-9']);
  });
});
