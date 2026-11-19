// The kiosk's offline bundle checks against the shared vectors the server tests also run
// (tests/test_business_permits.py): the same signatures, the same grace rules.
import { describe, expect, it } from 'vitest';
import vectors from './permitVectors.json';
import { mayPlay, permitStore, verifyBundle, type Permit, type SignedBundle } from './permit';

const v = vectors as unknown as {
  trusted: string[]; good: SignedBundle; older: SignedBundle; forged: SignedBundle; wrong_key: SignedBundle;
  held_issued_at: number; may_play: { name: string; permit: Permit; now: number; close: number | null; expect: boolean }[];
};

describe('the signed offline bundle (ADR-0446 BZ-0446-05)', () => {
  it('verifies the exact bytes the server signed', async () => {
    const verdict = await verifyBundle(v.good, v.trusted, null);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.bundle.permit.zone_id).toBe('zone');
  });

  it('refuses a forged bundle, an unknown key and an older bundle', async () => {
    expect(await verifyBundle(v.forged, v.trusted, null)).toEqual({ ok: false, reason: 'forged' });
    expect(await verifyBundle(v.wrong_key, v.trusted, null)).toEqual({ ok: false, reason: 'forged' });
    expect(await verifyBundle(v.older, v.trusted, v.held_issued_at)).toEqual({ ok: false, reason: 'older' });
    expect(await verifyBundle(v.good, [], null)).toEqual({ ok: false, reason: 'forged' });
  });

  it('keeps the verified bundle and trusts the keys it lists, across restarts', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, x: string) => { data.set(k, x); }, removeItem: (k: string) => { data.delete(k); } };
    const store = permitStore(storage, []);
    expect((await store.accept(v.good)).ok).toBe(false); // nothing pinned yet
    store.pin(v.trusted);
    expect((await store.accept(v.good)).ok).toBe(true);
    const again = permitStore(storage, []);
    expect(again.held()?.permit.device_id).toBe('dev');
    expect((await again.accept(v.older)).ok).toBe(false);
    again.clear();
    expect(permitStore(storage, []).held()).toBeNull();
  });
});

describe('offline grace (ADR-0446 BZ-0446-06): the same vectors as the server', () => {
  for (const item of v.may_play) {
    it(item.name, () => {
      expect(mayPlay(item.permit, item.now, item.close)).toBe(item.expect);
    });
  }
});
