// Browser-run synthetic fixtures; none of these measurements proves sound left a speaker.
const result = document.querySelector('#result');
const input = document.querySelector('#local');
const unlock = document.querySelector('#unlock');
const put = (message) => { result.textContent = message; };
const marker = { testOnly: true, physicalOutputVerified: false };
export function syntheticWav({ sampleRate = 44100, channels = 2, seconds = 0.3,
  silence = false, clip = false, frequency = 440, alternateMaster = false } = {}) {
  const frames = Math.floor(seconds * sampleRate);
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(bytes);
  const word = (at, s) => { for (let n = 0; n < s.length; n++) view.setUint8(at + n, s.charCodeAt(n)); };
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE');
  word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  for (let f = 0; f < frames; f++) {
    const value = silence ? 0 : clip ? 32767 : Math.round(12000 * Math.sin(2 * Math.PI *
      (alternateMaster ? frequency * 1.04 : frequency) * f / sampleRate));
    for (let ch = 0; ch < channels; ch++) view.setInt16(44 + (f * channels + ch) * 2, value, true);
  }
  return bytes;
}
export async function decode(bytes) {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(bytes.slice(0));
    let peak = 0, nonzero = 0;
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      for (const value of audio.getChannelData(ch)) {
        peak = Math.max(peak, Math.abs(value));
        if (Math.abs(value) > 0.0001) nonzero += 1;
      }
    }
    return { sampleRate: audio.sampleRate, channels: audio.numberOfChannels,
      duration: audio.duration, peak, nonzero, ...marker };
  } finally { await ctx.close(); }
}
export async function actualWorklet() {
  // OfflineAudioContext runs a real AudioWorkletProcessor without relying on an
  // OS audio device or headless Firefox/CI's missing physical audio sink.
  // This is genuine rendered PCM, NOT real-time output or speaker certification.
  const ctx = new OfflineAudioContext(1, 24000, 48000);
  if (!ctx.audioWorklet) throw new Error('Offline AudioWorklet is unavailable');
  await ctx.audioWorklet.addModule('/src/testsupport/browser/meter-worklet.js');
  const node = new AudioWorkletNode(ctx, 'selecta-qa-meter');
  const source = ctx.createOscillator();
  source.frequency.value = 400;
  source.connect(node); node.connect(ctx.destination);
  const activity = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No real worklet render callback in 4 seconds')), 4000);
    node.port.onmessage = ({ data }) => {
      if (data.blocks >= 8 && data.peak > 0.01) {
        clearTimeout(timeout);
        resolve(data);
      }
    };
  });
  source.start(0); source.stop(0.3);
  const [rendered, message] = await Promise.all([ctx.startRendering(), activity]);
  let renderedPeak = 0;
  for (const sample of rendered.getChannelData(0))
    renderedPeak = Math.max(renderedPeak, Math.abs(sample));
  if (renderedPeak < 0.01) throw new Error('Worklet rendered no audible-range digital PCM');
  return { ...message, renderedFrames: rendered.length, renderedPeak,
    renderMode: 'offline-worklet', physicalOutputVerified: false, testOnly: true };
}
export async function fileSelection() {
  const file = input.files?.[0];
  if (!file) return { selected: false, ...marker };
  const bytes = await file.arrayBuffer();
  return { selected: true, name: file.name, byteLength: bytes.byteLength,
    firstBytes: Array.from(new Uint8Array(bytes.slice(0, 4))), ...marker };
}
export async function codecFetch(name) {
  const response = await fetch('/fixtures/' + encodeURIComponent(name), { cache: 'no-store' });
  if (!response.ok) return { codec: name, outcome: 'fixture_missing', ...marker };
  try {
    const out = await decode(await response.arrayBuffer());
    return { codec: name, outcome: 'decoded', ...out };
  } catch (error) {
    return { codec: name, outcome: 'decode_failed',
      reason: String(error && error.message || error), ...marker };
  }
}
export const probe = () => ({
  secureContext: isSecureContext, worklet: !!window.AudioWorkletNode,
  audioContext: !!window.AudioContext, offlineContext: !!window.OfflineAudioContext,
  fileInput: 'files' in input, storageEstimate: !!navigator.storage?.estimate,
  locks: !!navigator.locks, opfs: !!navigator.storage?.getDirectory,
  webCodecs: !!window.AudioDecoder, wasm: !!window.WebAssembly,
  serviceWorker: 'serviceWorker' in navigator, userAgent: navigator.userAgent,
  ...marker,
});
window.__selectaBrowserQA = { probe, syntheticWav, decode, actualWorklet, fileSelection, codecFetch };
unlock.addEventListener('click', async () => {
  try { const evidence = await actualWorklet(); put('AudioWorklet callbacks: ' + evidence.blocks); }
  catch (error) { put('AudioWorklet failed: ' + String(error)); }
});
