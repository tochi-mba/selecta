// The big screen through a server restart and a disconnect (ADR-0416): it shows a quiet
// "Reconnecting..." over the room, comes back with the same token and no new code, goes back to
// a pairing code on the first look after the host disconnects it, and can disconnect itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../rooms/dom';

type Pending = { path: string; init?: RequestInit; resolve: (value: unknown) => void; reject: (error: unknown) => void };
const calls: Pending[] = [];

vi.mock('../rooms/dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('../rooms/dom')>();
  return {
    ...real,
    call: (path: string, init?: RequestInit) => new Promise((resolve, reject) => { calls.push({ path, init, resolve, reject }); }),
  };
});

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const paired = { state: 'paired', room_name: 'Party', code: 'ABCD-EFGH', join_path: '/r/ABCDEFGH', now_playing: null, up_next: [], upcoming: [], music_paused: false };
const offline = () => new ApiError(0, 'offline', "Can't reach SelectaDJ.");

beforeEach(() => {
  vi.resetModules();
  calls.length = 0;
  vi.useFakeTimers();
  document.body.innerHTML = '<main id="display"></main>';
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the big-screen display', () => {
  it('rides out a server restart, then goes back to pairing when the host disconnects it', async () => {
    await import('./main');
    calls.shift()!.resolve(paired);
    await flush();
    expect(document.querySelector('.d-room')).not.toBeNull();

    vi.advanceTimersByTime(3000);
    calls.shift()!.reject(offline());
    await flush();
    expect(document.getElementById('d-reconnecting')?.textContent).toBe('Reconnecting...');
    expect(document.getElementById('d-reconnecting')?.getAttribute('role')).toBe('status');
    expect(document.querySelector('.d-room')).not.toBeNull();

    vi.advanceTimersByTime(6000);
    calls.shift()!.resolve(paired); // the server is back; same token, still the room
    await flush();
    expect(document.getElementById('d-reconnecting')).toBeNull();
    expect(calls.filter((pending) => pending.path === '/api/display/pairings')).toHaveLength(0);

    vi.advanceTimersByTime(3000);
    calls.shift()!.resolve({ ...paired, state: 'unpaired' });
    await flush();
    const pairing = calls.shift()!;
    expect(pairing.path).toBe('/api/display/pairings');
    pairing.resolve({ pairing_code: 'K7Q-2MX', expires_at: 0 });
    await flush();
    expect(document.getElementById('d-pairing')?.textContent).toBe('K7Q-2MX');
  });

  it('disconnects itself and shows a new pairing code', async () => {
    await import('./main');
    calls.shift()!.resolve(paired);
    await flush();
    const button = document.getElementById('d-disconnect') as HTMLButtonElement;
    expect(button.textContent).toBe('Disconnect this screen');
    button.click();
    const gone = calls.shift()!;
    expect([gone.path, gone.init?.method]).toEqual(['/api/display/pairing', 'DELETE']);
    gone.resolve({ disconnected: true });
    await flush();
    const pairing = calls.shift()!;
    expect(pairing.path).toBe('/api/display/pairings');
    pairing.resolve({ pairing_code: 'P4R-8TY', expires_at: 0 });
    await flush();
    expect(document.getElementById('d-pairing')?.textContent).toBe('P4R-8TY');
    expect(document.querySelector('.d-room')).toBeNull();
  });
});
