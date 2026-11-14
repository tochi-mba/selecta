import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateBrowserAudioFeatures, probeBrowserAudio, type BrowserAudioFeatures } from './capabilities';

afterEach(() => { vi.unstubAllGlobals(); });

const baseline: BrowserAudioFeatures = {
  webAudio: true, worklet: true, fileInput: true,
  webLocks: true, broadcastChannel: true, originStorage: true,
};
describe('capability adapters (simulated API surfaces, NOT physical devices)', () => {
  it('does not invoke the native AudioContext.prototype.audioWorklet getter', () => {
    // Chrome/WebKit expose audioWorklet as an AudioContext instance accessor.
    // Looking it up on the prototype itself throws TypeError: Illegal invocation.
    class NativeLikeAudioContext {}
    let getterCalls = 0;
    Object.defineProperty(NativeLikeAudioContext.prototype, 'audioWorklet', {
      get() {
        getterCalls += 1;
        throw new TypeError('Illegal invocation');
      },
    });
    vi.stubGlobal('AudioContext', NativeLikeAudioContext);
    vi.stubGlobal('AudioWorkletNode', class NativeLikeWorkletNode {});
    expect(() => probeBrowserAudio()).not.toThrow();
    expect(getterCalls).toBe(0);
  });

  it('can probe WebKit-only AudioContext without reading its prototype accessor', () => {
    class WebkitAudioContext {}
    Object.defineProperty(WebkitAudioContext.prototype, 'audioWorklet', {
      get() { throw new TypeError('Illegal invocation'); },
    });
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', WebkitAudioContext);
    vi.stubGlobal('AudioWorkletNode', class WorkletNode {});
    expect(() => probeBrowserAudio()).not.toThrow();
  });

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
