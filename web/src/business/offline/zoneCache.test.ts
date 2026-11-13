import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAP_BYTES, cacheKeyOf, capFromEstimate, createZoneCache, memoryBlobStore, openBlobStore,
  type BlobStore, type Manifest, type Segment,
} from './zoneCache';

const NOW = 1_800_000_000;

function seg(i: number, over: Partial<Segment> = {}): Segment {
  return {
    id: `s${i}`, key: `art/${i}`, starts_at: NOW + i * 240, duration_s: 240, bytes: 100,
    sha256: `h${i}`, committed: i < 3, ...over,
  };
}

function manifest(count: number, over: (i: number) => Partial<Segment> = () => ({})): Manifest {
  return { zone_id: 'z1', version: 'v1', segments: Array.from({ length: count }, (_, i) => seg(i, over(i))) };
}

const blob = (size = 100) => new Blob([new Uint8Array(size)]);

function cache(cap = 10_000, store: BlobStore = memoryBlobStore()) {
  const clock = { now: NOW };
  const c = createZoneCache({ store, capBytes: cap, now: () => clock.now, hash: async () => null });
  return { c, clock, store };
}

describe('capFromEstimate', () => {
  it('is the smaller of 4 GB and half the quota', () => {
    expect(capFromEstimate(null)).toBe(DEFAULT_CAP_BYTES);
    expect(capFromEstimate({ quota: 2000 })).toBe(1000);
    expect(capFromEstimate({ quota: 100 * 1024 ** 3 })).toBe(DEFAULT_CAP_BYTES);
  });
});

describe('openBlobStore', () => {
  it('falls back to memory without IndexedDB or when open throws', async () => {
    const none = await openBlobStore(null);
    await none.put('k', blob(3));
    expect((await none.get('k'))?.size).toBe(3);
    const throwing = { open: () => { throw new Error('blocked'); } } as unknown as IDBFactory;
    const fallback = await openBlobStore(throwing);
    await fallback.putMeta('m', { a: 1 });
    expect(await fallback.getMeta('m')).toEqual({ a: 1 });
    expect(await fallback.getMeta('none')).toBeNull();
  });
});

describe('zoneCache', () => {
  it('lists missing segments nearest first and reports coverage', async () => {
    const { c } = cache();
    const m = manifest(5);
    await c.setManifest(m);
    expect(c.missing().map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    await c.put(m.segments[0], blob());
    await c.put(m.segments[1], blob());
    await c.put(m.segments[3], blob());
    expect(c.missing(m).map((s) => s.id)).toEqual(['s2', 's4']);
    expect(c.coverageSeconds(NOW)).toBe(480);
    expect(c.coverageSeconds(NOW + 100)).toBe(380);
    await c.put(m.segments[2], blob());
    expect(c.coverageSeconds(NOW)).toBe(960);
    expect(c.has(m.segments[2])).toBe(true);
    expect((await c.get(m.segments[2]))?.size).toBe(100);
    expect(await c.get(seg(9))).toBeNull();
  });

  it('keys by artifact key plus checksum and rejects a checksum mismatch', async () => {
    const store = memoryBlobStore();
    const c = createZoneCache({ store, now: () => NOW, hash: async () => 'H0' });
    const m = manifest(1, () => ({ sha256: 'h0' }));
    await c.setManifest(m);
    expect(await c.put(m.segments[0], blob())).toEqual({ ok: true });
    expect(cacheKeyOf(m.segments[0])).toBe('art/0:h0');
    expect(await store.get('art/0:h0')).not.toBeNull();
    expect(await c.put(seg(1, { sha256: 'other' }), blob())).toEqual({ ok: false, reason: 'checksum' });
  });

  it('evicts played segments oldest-played first to stay inside the cap', async () => {
    const { c, clock } = cache(500);
    const m = manifest(8);
    await c.setManifest(m);
    for (let i = 0; i < 5; i += 1) await c.put(m.segments[i], blob());
    clock.now += 10;
    await c.markPlayed(m.segments[1], NOW + 5);
    await c.markPlayed(m.segments[0], NOW + 9);
    expect(await c.put(m.segments[5], blob())).toEqual({ ok: true });
    expect(c.has(m.segments[1])).toBe(false);
    expect(c.has(m.segments[0])).toBe(true);
    expect(await c.put(m.segments[6], blob())).toEqual({ ok: true });
    expect(c.has(m.segments[0])).toBe(false);
    expect(c.usedBytes()).toBe(500);
  });

  it('never evicts the committed window or nearer planned files for a farther one', async () => {
    const { c } = cache(300);
    const m = manifest(6);
    await c.setManifest(m);
    for (let i = 0; i < 3; i += 1) await c.put(m.segments[i], blob());
    expect(await c.put(m.segments[3], blob())).toEqual({ ok: false, reason: 'no_room' });
    expect(c.missing().map((s) => s.id)).toEqual(['s3', 's4', 's5']);
    expect(c.usedBytes()).toBe(300);
  });

  it('evicts the furthest planned file to fit a nearer one', async () => {
    const { c } = cache(500);
    const m = manifest(8, (i) => ({ committed: i === 0 }));
    await c.setManifest(m);
    for (const i of [0, 1, 2, 6, 7]) await c.put(m.segments[i], blob());
    expect(await c.put(m.segments[3], blob())).toEqual({ ok: true });
    expect(c.has(m.segments[7])).toBe(false);
    expect(c.has(m.segments[6])).toBe(true);
  });

  it('drops files no longer planned before planned ones and enforces a smaller cap', async () => {
    const { c } = cache(1000);
    const first = manifest(5, () => ({ committed: false }));
    await c.setManifest(first);
    for (const s of first.segments) await c.put(s, blob());
    const next: Manifest = { ...first, version: 'v2', segments: first.segments.slice(2) };
    await c.setManifest(next);
    c.setCap(300);
    expect(await c.enforceCap()).toBe(2);
    expect(c.entries().map((e) => e.cacheKey).sort()).toEqual(['art/2:h2', 'art/3:h3', 'art/4:h4']);
    expect(c.cap()).toBe(300);
  });

  it('restores manifest and index after a reboot', async () => {
    const store = memoryBlobStore();
    const { c } = cache(10_000, store);
    const m = manifest(3);
    await c.setManifest(m);
    await c.put(m.segments[0], blob());
    const again = cache(10_000, store).c;
    await again.load();
    expect(again.manifest()?.version).toBe('v1');
    expect(again.has(m.segments[0])).toBe(true);
    expect(again.coverageSeconds(NOW)).toBe(240);
  });

  it('handles no manifest and missing persistence API', async () => {
    const { c } = cache();
    expect(c.missing()).toEqual([]);
    expect(c.coverageSeconds(NOW)).toBe(0);
    await c.markPlayed(seg(1));
    expect(typeof (await c.requestPersistence())).toBe('boolean');
  });

  it('uses memory when no store is given and IndexedDB is absent', async () => {
    const c = createZoneCache({ capBytes: 1000, now: () => NOW, hash: async () => null });
    const m = manifest(1);
    await c.setManifest(m);
    expect(await c.put(m.segments[0], blob())).toEqual({ ok: true });
    expect(c.coverageSeconds(NOW)).toBe(240);
  });
});
