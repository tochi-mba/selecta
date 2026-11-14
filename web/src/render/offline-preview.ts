/**
 * OfflineAudioContext is valuable for short, bounded previews, not for a giant
 * whole-mix render. This helper never buffers more than the capped preview.
 */
export async function offlinePreview(
  pcm: readonly Float32Array[],
  sampleRate: number,
  gain = 1,
): Promise<AudioBuffer> {
  if (!pcm.length || pcm.length > 2 || !pcm[0].length || pcm.some(c => c.length !== pcm[0].length)) {
    throw new Error('Invalid offline preview PCM');
  }
  if (!Number.isFinite(gain) || gain < 0 || gain > 2 || pcm[0].length > sampleRate * 10) {
    throw new Error('Offline preview must be at most ten seconds');
  }
  const context = new OfflineAudioContext(pcm.length, pcm[0].length, sampleRate);
  const buffer = context.createBuffer(pcm.length, pcm[0].length, sampleRate);
  pcm.forEach((channel, index) => buffer.copyToChannel(channel, index));
  const source = context.createBufferSource();
  source.buffer = buffer;
  const volume = context.createGain();
  volume.gain.value = gain;
  source.connect(volume);
  volume.connect(context.destination);
  source.start(0);
  return context.startRendering();
}
