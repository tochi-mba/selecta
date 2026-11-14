import { describe, expect, it } from 'vitest';
import { evaluateBrowserAudioFeatures, type BrowserAudioFeatures } from './capabilities';

const baseline: BrowserAudioFeatures = {
  webAudio: true, worklet: true, fileInput: true,
  webLocks: true, broadcastChannel: true, originStorage: true,
};
describe('capability adapters (simulated API surfaces, NOT physical devices)', () => {
  it('accepts a fully featured Chrome-like API surface', () => {
    expect(evaluateBrowserAudioFeatures(baseline)).toEqual({
      eligible: true, ownership: 'exclusive', reason: null,
    });
  });
  it('permits a WebKit-like player with cooperative fallback without claiming atomic fencing', () => {
    expect(evaluateBrowserAudioFeatures({ ...baseline, webLocks: false })).toEqual({
      eligible: true, ownership: 'cooperative', reason: null,
    });
  });
  it('reports Firefox-like missing browser facilities truthfully', () => {
    const result = evaluateBrowserAudioFeatures({ ...baseline, webLocks: false,
      broadcastChannel: false, originStorage: false });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('cross-tab');
  });
  it('does not infer phone, Safari or Firefox capabilities from user-agent strings', () => {
    expect(evaluateBrowserAudioFeatures({ ...baseline, worklet: false }).reason).toContain('AudioWorklet');
    expect(evaluateBrowserAudioFeatures({ ...baseline, webAudio: false }).reason).toContain('Web Audio');
  });
});
