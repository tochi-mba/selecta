import { afterEach, describe, expect, it } from 'vitest';
import { BrowserAudioLease } from './ownership';

afterEach(() => { delete (navigator as Navigator & { locks?: LockManager }).locks; });

describe('one browser-wide audio output across personal, Studio and venue modes', () => {
  it('refuses a second workspace owner until the current source is released', async () => {
    let held = false;
    const names: string[] = [];
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (name: string, _options: unknown,
        callback: (lock: object | null) => Promise<void>) => {
        names.push(name);
        if (held) { await callback(null); return; }
        held = true;
        try { await callback({}); } finally { held = false; }
      },
    } });
    const personal = new BrowserAudioLease('personal-123', () => {});
    const venue = new BrowserAudioLease('business-456', () => {});
    try {
      expect(await personal.acquire()).toBe('exclusive');
      expect(await venue.acquire()).toBe('unsupported');
      expect(names[0]).toEqual(names[1]);
      personal.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await venue.acquire()).toBe('exclusive');
    } finally {
      personal.dispose(); venue.dispose();
    }
  });
  it('does not reacquire a speaker from a lock granted after Stop', async () => {
    let grant!: () => void;
    const held = new Promise<void>((resolve) => { grant = resolve; });
    let calls = 0;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (_key: string, _options: unknown,
        callback: (lock: object | null) => Promise<void>) => {
        calls++;
        if (calls === 1) await held;
        await callback({});
      },
    } });
    const lease = new BrowserAudioLease('venue', () => {});
    try {
      const pending = lease.acquire();
      lease.release(); // cancels the pending Web Lock acquisition
      grant();
      expect(await pending).toBe('unsupported');
      expect(await lease.acquire()).toBe('exclusive');
    } finally { lease.dispose(); }
  });

  it('never grants a late lock after disposal', async () => {
    let grant!: () => void;
    const held = new Promise<void>((resolve) => { grant = resolve; });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (_key: string, _options: unknown,
        callback: (lock: object | null) => Promise<void>) => {
        await held;
        await callback({});
      },
    } });
    const lease = new BrowserAudioLease('venue', () => {});
    const pending = lease.acquire();
    lease.dispose();
    grant();
    expect(await pending).toBe('unsupported');
    expect(await lease.acquire()).toBe('unsupported');
  });
});
