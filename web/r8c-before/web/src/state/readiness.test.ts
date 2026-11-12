import { describe, expect, it } from 'vitest';
import { seam, songs } from '../test/backend';
import { draftReadiness, mixReadiness, trackReadiness } from './readiness';

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

describe('library eligibility and render failures', () => {
  it('never offers excluded music for manual mixing or analysis even with an old tempo', () => {
    expect(trackReadiness({ bpm: 120, readiness: { status: 'excluded', reason: 'Never plays' } })).toMatchObject({
      words: 'Never plays', canStartMix: false, canAdd: false, canAnalyse: false,
    });
    expect(trackReadiness({ bpm: null, readiness: { status: 'excluded', reason: 'Never plays' } }).canAnalyse).toBe(false);
  });

  it('shows failures before pending queue or rendering states', () => {
    const draft = {
      id: 7, name: 'Saved set', songs: 3, seconds: 500, seams: 2, ready: 0,
      failed: 1, waiting: 1, rendering: true, place: 1, eta: null, to_render: 1, missing: 0,
    };
    expect(draftReadiness(draft).kind).toBe('warning');
  });
});
