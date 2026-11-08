import { describe, expect, it } from 'vitest';
import { seam, songs } from '../test/backend';
import { mixReadiness } from './readiness';

describe('mix readiness with an invalid transition placement', () => {
  it('does not call a cached but cut-off seam ready for a continuous mix', () => {
    const mix = songs(seam('ready', 'a'), { ...seam('ready', 'b'), too_soon: true });
    expect(mixReadiness(mix)).toMatchObject({
      seams: 2, ready: 1, blocked: 1, failed: 0, waiting: 0,
      allReady: false, firstProblem: 2,
    });
  });

  it('does not offer to render a blocked unrendered transition', () => {
    const mix = songs({ ...seam('none', 'a'), too_soon: true });
    expect(mixReadiness(mix)).toMatchObject({
      ready: 0, waiting: 0, blocked: 1, allReady: false, firstProblem: 1,
    });
  });

  it('counts valid cached seams normally', () => {
    expect(mixReadiness(songs(seam('ready', 'a')))).toMatchObject({
      ready: 1, blocked: 0, allReady: true, firstProblem: null,
    });
  });
});
