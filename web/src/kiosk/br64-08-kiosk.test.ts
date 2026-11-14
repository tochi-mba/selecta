import { describe, expect, it, vi } from 'vitest';
import { browserKioskAudio } from './audio';
import type { VenueAudioPort, PlayerSnapshot } from '../venue-player/browserAudio';

describe('BR64-08 kiosk browser adapter', () => {
  it('delegates real preparation/start and never turns a silent unlock into playback', async () => {
    const s: PlayerSnapshot = {
      phase: 'ready', currentId: null, generation: 0, output: 'unverified',
      operatorCheckedAt: null, contextRunning: true, wakeLockHeld: false,
      foreground: true, online: true, preparedMinutes: 0, lastError: null,
    };
    const start = vi.fn(async () => { s.phase = 'playing'; s.currentId = 'a'; });
    const port: VenueAudioPort = {
      unlock: vi.fn(async () => true), importLocal: vi.fn(), prepare: vi.fn(async () => undefined),
      start, transition: vi.fn(async () => undefined), pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
      soundCheck: vi.fn(async () => undefined), confirmHeard: vi.fn(() => false),
      setVolume: vi.fn(), snapshot: () => s, playing: () => s.phase === 'playing' && s.output === 'operator_checked',
      savedHoursAhead: () => 0, dispose: vi.fn(async () => undefined),
    };
    const kiosk = browserKioskAudio(port);
    expect(await kiosk.unlock()).toBe(true);
    expect(kiosk.playing()).toBe(false);
    await kiosk.start('a', 1);
    expect(start).toHaveBeenCalledWith('a', 1);
    expect(kiosk.playing()).toBe(false);
    s.output = 'operator_checked';
    expect(kiosk.playing()).toBe(true);
  });
});
