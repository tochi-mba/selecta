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

const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
const waiting = { state: 'waiting', room_name: null, code: null, join_path: null, now_playing: null, up_next: [], upcoming: [], music_paused: false };

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the big-screen display', () => {
  it('shows its pairing code again after one missed poll', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main id="display"></main>';
    await import('./main');
    calls.shift()!.resolve(waiting);
    await flush();
    const started = calls.shift()!;
    expect(started.path).toBe('/api/display/pairings');
    started.resolve({ pairing_code: 'K7Q2', expires_at: 0 });
    await flush();
    expect(document.getElementById('d-pairing')?.textContent).toBe('K7Q2');

    // the network drops for one look, then comes back while the code is still waiting to be typed
    vi.advanceTimersByTime(3000);
    calls.shift()!.reject(new ApiError(0, 'offline', "Can't reach SelectaDJ."));
    await flush();
    vi.advanceTimersByTime(30_000);
    calls.shift()!.resolve(waiting);
    await flush();
    expect(calls.filter((pending) => pending.path === '/api/display/pairings')).toHaveLength(0);
    expect(document.getElementById('d-pairing')?.textContent).toBe('K7Q2');
  });
});
