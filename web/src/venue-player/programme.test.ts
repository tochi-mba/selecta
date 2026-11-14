import { describe, expect, it, vi } from 'vitest';
import { BrowserVenueProgramme } from './programme';
import type { BrowserVenueIntegrations } from './contracts';
import type { PlayerSnapshot } from './browserAudio';
import type { VenuePolicy } from './policy';

const NOW = Date.parse('2026-11-14T23:30:00Z');
const policy: VenuePolicy = {
  timezone: 'Europe/London', revision: 'policy-9', rightsAttested: true,
  rightsUntilEpochMs: null, allowExplicit: false, blockedArtists: [],
  openings: [{ day: 'sat', startMinute: 1200, endMinute: 1560 }], dayparts: [],
};
function fixture(options: { offline?: boolean; foreground?: boolean; rights?: boolean } = {}) {
  const source = vi.fn(async () => new File(['locally granted'], 'local.wav'));
  const play = vi.fn(async () => undefined);
  const transition = vi.fn(async () => undefined);
  const report = vi.fn(async (_payload: Parameters<BrowserVenueIntegrations['cloud']['report']>[0]) => undefined);
  const snapshot: PlayerSnapshot = {
    phase: 'playing', currentId: 'a', generation: 1, output: 'unverified',
    operatorCheckedAt: null, contextRunning: true, wakeLockHeld: false,
    foreground: options.foreground ?? true, online: !options.offline,
    preparedMinutes: 3, remainingSeconds: 3, lastError: null,
  };
  const adapters: BrowserVenueIntegrations = {
    audio: {
      unlock: vi.fn(async () => true), importLocal: vi.fn(), bindLocal: vi.fn(),
      prepare: vi.fn(async () => undefined), start: play, transition,
      pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined), soundCheck: vi.fn(async () => undefined),
      confirmHeard: vi.fn(() => false), setVolume: vi.fn(),
      snapshot: () => snapshot, playing: () => false, savedHoursAhead: () => 0,
      dispose: vi.fn(async () => undefined),
    },
    media: {
      eligible: vi.fn(async (_zone: string, id: string) => ({
        id, artist: 'Clean artist', explicit: false as const,
        locallyAuthorised: true, exactRevisionVerified: true, blocked: false,
      })),
      resolveFile: source,
      sourceState: vi.fn(async () => 'connected' as const),
    },
    cloud: {
      acquire: vi.fn(async () => ({ generation: 1, expiresAt: NOW + 120_000 })),
      report, commandReceipt: vi.fn(async () => undefined),
    },
    programme: {
      policy: vi.fn(async () => ({ ...policy, rightsAttested: options.rights !== false })),
      horizon: vi.fn(async () => ({
        committed: [{ id: 'a', revision: 'v1' }, { id: 'b', revision: 'v1' }],
        prepared: [], planned: [{ id: 'future', revision: 'v1' }],
        fallback: [{ id: 'fallback', revision: 'v1' }],
      })),
      requestProgress: vi.fn(async () => undefined),
    },
  };
  return { adapters, play, transition, report, source, snapshot };
}
const scope = { workspaceId: 'org1', venueId: 'v1', zoneId: 'z1', deviceId: 'ipad1' };
describe('BR64-08 foreground browser venue programme', () => {
  it('uses local authorised files for a committed transition and Cloud only for metadata', async () => {
    const f = fixture();
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await runner.start();
      expect(f.play).toHaveBeenCalledWith('a', 1);
      await runner.tick();
      expect(f.transition).toHaveBeenCalledWith('b', 2);
      expect(runner.status().current).toBe('b');
      const sent = f.report.mock.calls[0]?.[0];
      expect(sent).toMatchObject({ workspaceId: 'org1', zoneId: 'z1', committedMinutes: 0, plannedMinutes: 0 });
      expect(JSON.stringify(sent)).not.toMatch(/local.wav|file|pcm|blob|raw_audio/);
    } finally { await runner.dispose(); }
  });
  it('continues from locally granted media during internet loss while foregrounded', async () => {
    const f = fixture({ offline: true });
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await runner.start();
      await runner.tick();
      expect(f.transition).toHaveBeenCalledTimes(1);
      expect(f.report).not.toHaveBeenCalled();
      expect(f.source).toHaveBeenCalled();
    } finally { await runner.dispose(); }
  });
  it('blocks rights-unattested setup before acquiring a live speaker lease', async () => {
    const f = fixture({ rights: false });
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await expect(runner.start()).rejects.toThrow(/policy/);
      expect(f.play).not.toHaveBeenCalled();
    } finally { await runner.dispose(); }
  });
  it('retries failed next-track preparation instead of marking a failed decode ready', async () => {
    const f = fixture();
    f.snapshot.remainingSeconds = 20;
    let attempts = 0;
    f.adapters.audio.prepare = vi.fn(async (id: string) => {
      if (id === 'b' && ++attempts === 1) throw new Error('Temporary local decode failure');
    });
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await runner.start();
      await runner.tick();
      expect(runner.status().issue).toMatch(/Temporary local decode failure/);
      await runner.tick();
      expect(attempts).toBe(2);
      expect(runner.status().issue).toBeNull();
    } finally { await runner.dispose(); }
  });

  it('refuses browser suspension as grounds to claim continuous local playback', async () => {
    const f = fixture();
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await runner.start();
      f.snapshot.foreground = false;
      await runner.tick();
      expect(runner.status().state).toBe('interrupted');
      expect(f.transition).not.toHaveBeenCalled();
    } finally { await runner.dispose(); }
  });
  it('serialises a manual skip against an in-flight browser transition', async () => {
    const f = fixture();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    f.adapters.media.resolveFile = vi.fn(async (_zone: string, id: string) => {
      if (id === 'b') await hold;
      return new File(['locally granted'], id + '.wav');
    });
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await runner.start();
      const first = runner.skip();
      await vi.waitFor(() => expect(f.adapters.media.resolveFile).toHaveBeenCalledWith('z1', 'b', 'v1'));
      await expect(runner.skip()).rejects.toThrow('already preparing');
      release();
      await first;
      expect(f.transition).toHaveBeenCalledTimes(1);
      expect(runner.status().current).toBe('b');
    } finally { release(); await runner.dispose(); }
  });

  it('does not resurrect a speaker stopped during asynchronous source preparation', async () => {
    const f = fixture();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    f.adapters.media.resolveFile = vi.fn(async (_zone: string, id: string) => {
      if (id === 'b') await hold;
      return new File(['locally granted'], id + '.wav');
    });
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await runner.start();
      const pendingTick = runner.tick();
      await vi.waitFor(() => expect(f.adapters.media.resolveFile).toHaveBeenCalledWith('z1', 'b', 'v1'));
      await runner.stop();
      release();
      await pendingTick;
      expect(f.transition).not.toHaveBeenCalled();
      expect(runner.status().state).toBe('idle');
    } finally { release(); await runner.dispose(); }
  });

  it('does not start the venue after Stop cancels pending Cloud ownership acquisition', async () => {
    const f = fixture();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    f.adapters.cloud.acquire = vi.fn(async () => {
      await hold;
      return { generation: 1, expiresAt: NOW + 120_000 };
    });
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      const start = runner.start();
      await vi.waitFor(() => expect(f.adapters.cloud.acquire).toHaveBeenCalledTimes(1));
      await expect(runner.start()).rejects.toThrow('already preparing');
      await runner.stop();
      release();
      await expect(start).rejects.toThrow('cancelled');
      expect(f.play).not.toHaveBeenCalled();
      expect(runner.status().state).toBe('idle');
    } finally { release(); await runner.dispose(); }
  });

  it('requires on-device Start instead of unsafe Resume after a browser interruption', async () => {
    const f = fixture();
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await runner.start();
      f.snapshot.foreground = false;
      await runner.tick();
      await expect(runner.resume()).rejects.toThrow('Use Start');
    } finally { await runner.dispose(); }
  });

  it('rejects unbounded noncommitted horizons before requesting a Cloud speaker lease', async () => {
    const f = fixture();
    f.adapters.programme.horizon = vi.fn(async () => ({
      committed: [{ id: 'a', revision: 'v1' }],
      prepared: Array.from({ length: 201 }, (_, i) => ({ id: 'extra' + i, revision: 'v1' })),
      planned: [], fallback: [],
    }));
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await expect(runner.start()).rejects.toThrow('missing or unversioned');
      expect(f.adapters.cloud.acquire).not.toHaveBeenCalled();
    } finally { await runner.dispose(); }
  });

  it('does not keep a false running venue when AudioContext stops although page is visible', async () => {
    const f = fixture();
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await runner.start();
      f.snapshot.contextRunning = false;
      await runner.tick();
      expect(runner.status().state).toBe('interrupted');
      expect(f.transition).not.toHaveBeenCalled();
      await expect(runner.resume()).rejects.toThrow('Use Start');
    } finally { await runner.dispose(); }
  });
  it('does not falsely report source readiness after the music device disconnects', async () => {
    const f = fixture();
    f.snapshot.remainingSeconds = 90;
    const runner = new BrowserVenueProgramme(scope, f.adapters, () => NOW);
    try {
      await runner.start();
      f.adapters.media.sourceState = vi.fn(async () => 'disconnected' as const);
      await runner.tick();
      expect(f.report).toHaveBeenCalledTimes(1);
      expect(f.report.mock.calls[0][0].sourceReady).toBe(false);
      expect(runner.status().issue).toMatch(/source is unavailable/);
    } finally { await runner.dispose(); }
  });
});
