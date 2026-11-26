import { describe, expect, it } from 'vitest';
import { clipHash, seamKey } from './seamReports';

describe('seam keys and clip hashes', () => {
  it('works out the key the account does (seams_routes.device_seam_key)', async () => {
    // the same values tests/test_cloud_brain_seams.py pins on the server's side
    expect(await seamKey(1, 2, 'a'.repeat(64), 2)).toBe('beba0e3e932a76417d57');
    expect(await seamKey(7, 3, 'b'.repeat(64), 'fallback')).toBe('5f3fe31dad1a7256eb34');
  });

  it('names a clip by its samples: the same clip the same hash, another clip another', async () => {
    const one = [new Float32Array([0, 0.5, -0.5]), new Float32Array([1, 0, 0])];
    const same = [new Float32Array([0, 0.5, -0.5]), new Float32Array([1, 0, 0])];
    const other = [new Float32Array([0, 0.5, -0.5]), new Float32Array([1, 0, 0.25])];
    expect(await clipHash(one)).toBe(await clipHash(same));
    expect(await clipHash(one)).not.toBe(await clipHash(other));
    expect(await clipHash(one)).toMatch(/^[0-9a-f]{64}$/);
  });
});
