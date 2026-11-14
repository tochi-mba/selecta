// Produces owned synthetic audio only; no copyrighted samples or user files.
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve('node_modules/.cache/selecta-browser-qa');
await mkdir(root, { recursive: true });
function riff(rate, channels, seconds, kind = 'sine') {
  const samples = Math.floor(rate * seconds);
  const pcm = Buffer.alloc(44 + samples * channels * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVE', 8);
  pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(channels, 22); pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * channels * 2, 28); pcm.writeUInt16LE(channels * 2, 32);
  pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(samples * channels * 2, 40);
  for (let i = 0; i < samples; i++) {
    const value = kind === 'silence' ? 0 : kind === 'clipped' ? 32767 :
      Math.round(Math.sin(i * 2 * Math.PI * (kind === 'wrong-master' ? 453 : 440) / rate) * 12000);
    for (let c = 0; c < channels; c++) pcm.writeInt16LE(value, 44 + (i * channels + c) * 2);
  }
  return pcm;
}
const samples = [
  ['mono-22050.wav', 22050, 1, 1, 'sine'], ['mono-44100.wav', 44100, 1, 1, 'sine'],
  ['mono-48000.wav', 48000, 1, 1, 'sine'], ['stereo-48000.wav', 48000, 2, 1, 'sine'],
  ['silence.wav', 44100, 2, 1, 'silence'], ['clipping.wav', 44100, 2, 1, 'clipped'],
  ['wrong-master.wav', 44100, 2, 1, 'wrong-master'],
  ['long-180s.wav', 22050, 1, 180, 'sine'],
];
for (const [name, rate, channels, seconds, kind] of samples)
  await writeFile(resolve(root, name), riff(rate, channels, seconds, kind));
await writeFile(resolve(root, 'corrupt.wav'), Buffer.from([0, 1, 2, 3, 4]));
const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
if (ffmpeg.status !== 0) {
  console.error('ffmpeg missing (developer/CI fixture generator only; not required by Cloud users)');
  process.exitCode = 2;
} else {
  for (const [name, codec] of [
    ['sample.mp3', ['-c:a', 'libmp3lame']],
    ['sample.m4a', ['-c:a', 'aac']],
    ['sample.flac', ['-c:a', 'flac']],
    ['sample.opus', ['-c:a', 'libopus']],
  ]) {
    const args = ['-v', 'error', '-nostdin', '-y', '-i', resolve(root, 'stereo-48000.wav'),
      ...codec, resolve(root, name)];
    const out = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
    if (out.status !== 0) { console.error(name, out.stderr); process.exitCode = 1; }
  }
}
console.log('[BROWSER-QA] Generated fixtures in local ignored pnpm cache:', root);
