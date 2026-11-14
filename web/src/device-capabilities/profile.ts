/** Runtime feature decisions, not a browser-name allowlist. */
export type FeatureDecision = 'available' | 'degraded' | 'unsupported_here' | 'unverified';
export type Feature = 'local_files' | 'directory_picker' | 'audio_decode' | 'realtime_audio' | 'wasm_simd'
  | 'workers' | 'storage' | 'wake_lock' | 'output_selection' | 'render' | 'webgpu_model';
export type CapabilityResult = { decision: FeatureDecision; reason: string };
export type BrowserCapabilityProfile = {
  schema_version: 1;
  assessed_at: string;
  features: Record<Feature, CapabilityResult>;
  storage: { quotaBytes: number | null; usageBytes: number | null; persisted: boolean | null };
  probe: { syntheticMs: number | null; workload: string; bounded: true };
};
const unavailable = (reason: string): CapabilityResult => ({ decision: 'unsupported_here', reason });
const unverified = (reason: string): CapabilityResult => ({ decision: 'unverified', reason });
const available = (reason: string): CapabilityResult => ({ decision: 'available', reason });
const degraded = (reason: string): CapabilityResult => ({ decision: 'degraded', reason });
function simdSupported(): boolean {
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.validate !== 'function') return false;
  // Minimal valid SIMD module: func returns v128 via v128.const then drops it.
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,26,1,24,0,253,12,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,26,11]);
  try { return WebAssembly.validate(bytes); } catch { return false; }
}
/** Probe arithmetic in a disposable worker, at most 180ms wall time, never in AudioWorklet. */
export async function boundedSyntheticProbe(signal?: AbortSignal): Promise<number | null> {
  if (typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function' || signal?.aborted) return null;
  const source = 'onmessage=()=>{const t=performance.now();let a=0;for(let i=0;i<32768;i++)a+=Math.sin(i)*Math.cos(i/2);postMessage({ms:performance.now()-t,ok:Number.isFinite(a)})}';
  let worker: Worker | null = null;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    worker = new Worker(url);
    const running = worker;
    return await new Promise((resolve) => {
      let done = false;
      const finish = (value: number | null) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value); };
      const abort = () => finish(null);
      const timer = setTimeout(() => finish(null), 180);
      signal?.addEventListener('abort', abort, { once: true });
      running.onmessage = (event: MessageEvent<{ ms: number; ok: boolean }>) =>
        finish(event.data.ok && Number.isFinite(event.data.ms) ? event.data.ms : null);
      running.onerror = () => finish(null);
      running.postMessage(1);
    });
  } catch { return null; }
  finally { worker?.terminate(); if (url) URL.revokeObjectURL(url); }
}
export async function assessBrowserDevice(signal?: AbortSignal): Promise<BrowserCapabilityProfile> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const audio = typeof window !== 'undefined' &&
    ('AudioContext' in window || 'webkitAudioContext' in window);
  const worklet = typeof AudioWorkletNode !== 'undefined';
  const files = typeof File !== 'undefined' && typeof FileReader !== 'undefined';
  const picker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const workers = typeof Worker !== 'undefined';
  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  let persisted: boolean | null = null;
  try {
    const estimate = await nav?.storage?.estimate?.();
    quotaBytes = typeof estimate?.quota === 'number' ? estimate.quota : null;
    usageBytes = typeof estimate?.usage === 'number' ? estimate.usage : null;
    persisted = typeof nav?.storage?.persisted === 'function' ? await nav.storage.persisted() : null;
  } catch { /* privacy mode or denied storage APIs */ }
  if (signal?.aborted) throw new DOMException('Capability check cancelled', 'AbortError');
  const syntheticMs = await boundedSyntheticProbe(signal);
  const storage = quotaBytes == null ? unverified('Browser storage quota is not exposed; local cached files may be evicted')
    : quotaBytes - (usageBytes ?? 0) < 64 * 1024 * 1024
      ? degraded('Less than 64 MB estimated local space; avoid caching or long renders')
      : available('Estimated local browser space available; still subject to eviction');
  const audioDecode = audio ? unverified('AudioContext exists; verify an actual local recording with the decoder') : unavailable('Web Audio API is absent');
  const realtime = audio && worklet ? available('AudioWorklet supported; real output must be unlocked and tested')
    : audio ? degraded('No AudioWorklet; only a separately validated simple playback fallback') : unavailable('Web Audio unavailable');
  const render = !audio ? unavailable('No Web Audio for local rendering') :
    !workers ? degraded('Main-thread rendering only; long jobs must be deferred or disabled') :
    syntheticMs == null ? unverified('Worker throughput not confirmed; run a local render qualification') :
    syntheticMs > 60 ? degraded('Synthetic worker throughput is limited; prefer shorter chunked renders') :
    available('Local worker probe completed; actual codec/DSP render still requires preflight');
  const sink = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const wake = nav && 'wakeLock' in nav;
  return {
    schema_version: 1, assessed_at: new Date().toISOString(),
    storage: { quotaBytes, usageBytes, persisted },
    probe: { syntheticMs, workload: '32768 synthetic trigonometric iterations in isolated worker', bounded: true },
    features: {
      local_files: files ? available('Use file selection; SD/USB/provider only when explicitly offered by browser') : unavailable('File selection unavailable'),
      directory_picker: picker ? available('Directory picker offered; permission is user-controlled and revocable')
        : files ? degraded('Choose multiple files; folder picker may work through directory input') : unavailable('No local file API'),
      audio_decode: audioDecode,
      realtime_audio: realtime,
      wasm_simd: simdSupported() ? available('WASM SIMD instruction validated') : degraded('SIMD not available; scalar DSP only if benchmarked'),
      workers: workers ? available('Dedicated workers exposed') : degraded('Workers absent or disabled'),
      storage,
      wake_lock: wake ? unverified('Wake Lock API exposed; request foreground lock on user action') : degraded('Keep display awake manually; background playback is not guaranteed'),
      output_selection: sink ? unverified('Output selection API present; requires permission and real speaker test') : degraded('Select audio output in system controls; multi-zone not guaranteed'),
      render,
      webgpu_model: nav && 'gpu' in nav ? unverified('WebGPU advertised; each model must independently load and pass device tests')
        : unavailable('WebGPU not available; model-specific WASM fallback may still exist'),
    },
  };
}
export function featureAllowed(profile: BrowserCapabilityProfile, feature: Feature): boolean {
  return profile.features[feature].decision === 'available' || profile.features[feature].decision === 'degraded';
}
