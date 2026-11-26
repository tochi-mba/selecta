import { describe, expect, it } from 'vitest';
import { Pcg64, seedState } from './rng';

// numpy's generator, as the Desktop's reverb seeds it (default_rng(11)). The expected values are
// numpy 2.5.4's: SeedSequence(11).generate_state(4, np.uint64), PCG64(11).random_raw(3), and
// default_rng(11).standard_normal(6).

describe("numpy's default_rng(11)", () => {
  it('seeds PCG64 as SeedSequence does', () => {
    expect(seedState(11).map((word) => word.toString(16))).toEqual(['367e754172d24763', '289d5074abaac1fc', '2fc5603fff038e1', 'd8000b4940c339a5']);
  });

  it('gives the same 64-bit words', () => {
    const generator = new Pcg64(11);
    expect([0, 1, 2].map(() => generator.nextUint64().toString(16))).toEqual(['20e9fa102240cc4e', '7fd0ac8acc0d7a67', '99fbcbde970c647c']);
  });

  it('gives the same normals', () => {
    const generator = new Pcg64(11);
    const values = Array.from({ length: 6 }, () => generator.standardNormal());
    expect(values).toEqual(EXPECTED_NORMALS);
  });
});

const EXPECTED_NORMALS = [0.03419276725318417, 1.3597475403099617, 1.2247210785859324, -0.5103070767876675, -0.2979695111064471, -0.5273841930334252];
