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

const view = {
  room_name: 'Party', room_status: 'open', guest_status: 'active', nickname: 'Fox',
  votes_on: false, requests_open: true, music_paused: false,
  now_playing: null, up_next: [], coming_up: [], waiting: [], my_requests: [],
};

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the guest page', () => {
  it('stays left when a poll that started before Leave answers afterwards', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/r/ABCD1234');
    localStorage.setItem('selecta.guest.room.ABCD1234', 'room-1');
    document.body.innerHTML = '<main id="guest"></main>';
    await import('./main');
    calls.shift()!.resolve(view);
    await flush();
    expect(document.getElementById('g-shell')).not.toBeNull();

    // a poll goes out, then the guest leaves while it is still on its way
    vi.advanceTimersByTime(5000);
    const poll = calls.shift()!;
    expect(poll.path).toBe('/api/guest/rooms/room-1');
    const leave = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Leave room')!;
    leave.click();
    calls.shift()!.resolve({});
    await flush();
    expect(document.querySelector('h1')?.textContent).toBe('You left the room');

    poll.resolve(view);
    await flush();
    expect(document.querySelector('h1')?.textContent).toBe('You left the room');
    expect(document.getElementById('g-shell')).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(calls).toHaveLength(0);
  });
});
