/** Runtime capability probing, not user-agent gating. A phone may be a full player. */
export interface BrowserAudioFeatures {
  webAudio: boolean;
  worklet: boolean;
  fileInput: boolean;
  webLocks: boolean;
  broadcastChannel: boolean;
  originStorage: boolean;
}
export interface BrowserAudioEligibility {
  eligible: boolean;
  ownership: 'exclusive' | 'cooperative' | 'unsupported';
  reason: string | null;
}
export function evaluateBrowserAudioFeatures(features: BrowserAudioFeatures): BrowserAudioEligibility {
  const ownership = features.webLocks ? 'exclusive' :
    features.broadcastChannel && features.originStorage ? 'cooperative' : 'unsupported';
  if (!features.fileInput) return { eligible: false, ownership, reason: 'This browser cannot accept local File objects.' };
  if (!features.webAudio) return { eligible: false, ownership, reason: 'Web Audio is unavailable.' };
  if (!features.worklet) return { eligible: false, ownership, reason: 'AudioWorklet is unavailable.' };
  if (ownership === 'unsupported') {
    return { eligible: false, ownership, reason: 'Safe cross-tab audio ownership is unavailable.' };
  }
  return { eligible: true, ownership, reason: null };
}
export function probeBrowserAudio(): BrowserAudioEligibility {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { eligible: false, ownership: 'unsupported', reason: 'A browser is required.' };
  }
  const legacy = window as Window & { webkitAudioContext?: typeof AudioContext };
  let originStorage = false;
  try {
    const key = 'selecta-br64-storage-probe';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    originStorage = true;
  } catch { /* private or restricted browsing */ }
  return evaluateBrowserAudioFeatures({
    webAudio: Boolean(window.AudioContext || legacy.webkitAudioContext),
    worklet: typeof AudioWorkletNode !== 'undefined' && Boolean(window.AudioContext?.prototype.audioWorklet ||
      // Some WebKit builds expose only instance.audioWorklet, not prototype access.
      typeof AudioWorkletNode !== 'undefined'),
    fileInput: typeof File !== 'undefined',
    webLocks: Boolean(navigator.locks?.request),
    broadcastChannel: typeof BroadcastChannel !== 'undefined',
    originStorage,
  });
}
