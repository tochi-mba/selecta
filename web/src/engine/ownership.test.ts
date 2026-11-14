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
});
