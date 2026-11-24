// ADR-0475: a browser-first room offers only the songs of the device making the sound. With no
// such device yet, or while it reconnects, the guest is told so (never which device), search
// waits with their text kept, and when the music is back their search runs again by itself.
import { afterEach, describe, expect, it, vi } from 'vitest';

type Pending = { path: string; resolve: (value: unknown) => void; reject: (error: unknown) => void };
const calls: Pending[] = [];

vi.mock('../rooms/dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('../rooms/dom')>();
  return { ...real, call: (path: string) => new Promise((resolve, reject) => { calls.push({ path, resolve, reject }); }) };
});

const view = (music: string) => ({
  room_name: 'Party', room_status: 'open', guest_status: 'active', nickname: 'Fox',
  votes_on: false, requests_open: true, music_paused: false,
  now_playing: null, up_next: [], coming_up: [], waiting: [], my_requests: [], music,
});
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
const said = () => document.querySelector('[data-music]')?.textContent ?? '';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('the guest page and the room’s music', () => {
  it('waits while the host chooses, keeps the typed search, and runs it when the music is back', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/r/MUSIC234');
    localStorage.setItem('selecta.guest.room.MUSIC234', 'room-m');
    document.body.innerHTML = '<main id="guest"></main>';
    await import('./main');
    calls.shift()!.resolve(view('choosing'));
    await flush();
    expect(said()).toBe('The host is choosing where the music plays.You can ask for songs in a moment.');
    const box = document.getElementById('g-q') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    box.value = 'flux';
    // the next look finds a device playing
    vi.advanceTimersByTime(5000);
    calls.shift()!.resolve(view('ready'));
    await flush();
    expect(said()).toBe('');
    expect(box.disabled).toBe(false);
    expect(box.value).toBe('flux');
    vi.advanceTimersByTime(250);
    expect(calls.some((call) => call.path.includes('/search?q=flux'))).toBe(true);
    // no music at all: no search box, and it says why
    vi.advanceTimersByTime(5000);
    calls.filter((call) => call.path.endsWith('/room-m')).forEach((call) => call.resolve(view('none')));
    calls.splice(0);
    await flush();
    expect(said()).toContain('The host hasn’t connected any music yet.');
    expect(document.getElementById('g-search')?.hidden).toBe(true);
    expect(document.body.textContent).not.toMatch(/Edge|Android|Windows|device_id/);
  });
});
