import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from './usePlaybackDevice';
import { HOLDING_ROUTE, heldZone, heldZoneName, useHeldZone } from './zonePlayback';

const answering = (answer: unknown): Api & ReturnType<typeof vi.fn> =>
  vi.fn(async () => answer) as unknown as Api & ReturnType<typeof vi.fn>;

describe('heldZone (ADR-0443 GET /api/zones/holding)', () => {
  it('asks the holding route in the organisation workspace and returns the zone id', async () => {
    const api = answering({ zone_id: 'zone-bar' });
    await expect(heldZone(api, 'org-1')).resolves.toBe('zone-bar');
    expect(api).toHaveBeenCalledWith(HOLDING_ROUTE, {}, 'org-1');
  });

  it('reads no zone, a refusal or a broken answer as holding nothing', async () => {
    await expect(heldZone(answering({ zone_id: null }), 'org-1')).resolves.toBeNull();
    await expect(heldZone(answering({}), 'org-1')).resolves.toBeNull();
    await expect(heldZone(answering(null), 'org-1')).resolves.toBeNull();
    const refused = vi.fn(async () => { throw new Error('404'); }) as unknown as Api;
    await expect(heldZone(refused, 'org-1')).resolves.toBeNull();
  });
});

describe('useHeldZone', () => {
  it('asks once a workspace is known and again when the refresh key moves', async () => {
    const api = answering({ zone_id: 'zone-bar' });
    const { result, rerender } = renderHook(({ ws, key }) => useHeldZone(api, ws, key), {
      initialProps: { ws: null as string | null, key: 1 },
    });
    expect(result.current).toBeNull();
    expect(api).not.toHaveBeenCalled();
    rerender({ ws: 'org-1', key: 1 });
    await waitFor(() => expect(result.current).toBe('zone-bar'));
    expect(api).toHaveBeenCalledTimes(1);
    rerender({ ws: 'org-1', key: 2 });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  });
});

describe('heldZoneName', () => {
  const zones = [{ id: 'zone-bar', name: 'Bar' }, { id: 'zone-patio', name: 'Patio' }];
  it('names the held zone, falls back to the generic words, and is null when nothing is held', () => {
    expect(heldZoneName('zone-bar', zones)).toBe('Bar');
    expect(heldZoneName('zone-gone', zones)).toBe('a zone');
    expect(heldZoneName(null, zones)).toBeNull();
  });
});
