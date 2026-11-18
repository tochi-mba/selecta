import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { decodeFlac } from '../src/engine/flacDecode';
import type { HarnessResult } from './exportHarness';

// BF-0457-06: the long-mix export in a real browser (muted, like every cloud spec). A
// multi-minute synthetic mix is rendered by the engine's chunked OfflineAudioContext path and
// limiter, encoded as WAV and as FLAC by the shipped encoders, checked in the page, then handed
// to this test, which checks it again independently: the header, the duration, the sha256 the
// page reported, and for FLAC a full decode with the STREAMINFO MD5. The FLAC must also hold
// exactly the samples of the WAV export of the same mix. A cancelled export must hand back no
// file at all. No assertion here is about sound: muted CI proves processing, not audibility.
//
// The harness (exportHarness.ts) is bundled here with Vite's build API and injected into the
// page, so the app build stays free of test code.

const MIX_TRACK_SECONDS = [70, 65, 70]; // a little over three and a half minutes, end to end
const RATE = 44100;

let harness = '';
test.beforeAll(async () => {
  const entry = fileURLToPath(new URL('./exportHarness.ts', import.meta.url));
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: 'selectaExportHarness', fileName: 'export-harness' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const results = Array.isArray(output) ? output : [output];
  for (const result of results) {
    if (!('output' in result)) continue;
    for (const item of result.output) if (item.type === 'chunk') harness += item.code;
  }
  expect(harness.length).toBeGreaterThan(1000);
});

test.use({ bypassCSP: true });

type Ok = Extract<HarnessResult, { ok: true }>;

async function exportIn(page: import('@playwright/test').Page, format: 'wav' | 'flac', cancelAfterMs?: number): Promise<HarnessResult> {
  await page.goto('/api/status');
  await page.addScriptTag({ content: harness });
  return page.evaluate(
    ([chosen, seconds, cancel]) => (window as unknown as { selectaExportE2E: (f: string, s: number[], c?: number) => Promise<HarnessResult> })
      .selectaExportE2E(chosen as string, seconds as number[], cancel as number | undefined),
    [format, MIX_TRACK_SECONDS, cancelAfterMs] as const,
  );
}

function checkedBytes(result: Ok): Buffer {
  const bytes = Buffer.from(result.base64, 'base64');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.sha256);
  return bytes;
}

test('a long synthetic mix exports as a checked WAV and a checked FLAC holding the same samples', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const wav = await exportIn(page, 'wav');
  expect(wav.ok, JSON.stringify(wav).slice(0, 300)).toBe(true);
  const flac = await exportIn(page, 'flac');
  expect(flac.ok, JSON.stringify(flac).slice(0, 300)).toBe(true);
  if (!wav.ok || !flac.ok) return;

  // The engine's own seam fade overlaps neighbouring songs, so the mix is a little shorter than
  // the sum of its songs; it must still be several minutes and match what the page reported.
  const nominal = MIX_TRACK_SECONDS.reduce((sum, seconds) => sum + seconds, 0);
  for (const result of [wav, flac]) {
    expect(result.durationSeconds).toBeGreaterThan(nominal - 30);
    expect(result.durationSeconds).toBeLessThanOrEqual(nominal);
    expect(result.durationSeconds).toBeGreaterThan(180);
    expect(result.progress.length).toBeGreaterThan(3); // rendered in chunks
  }

  const wavBytes = checkedBytes(wav);
  expect(wav.mimeType).toBe('audio/wav');
  expect(wavBytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wavBytes.readUInt32LE(4)).toBe(wavBytes.length - 8);
  expect(wavBytes.toString('ascii', 8, 16)).toBe('WAVEfmt ');
  expect(wavBytes.readUInt16LE(20)).toBe(1);
  expect(wavBytes.readUInt16LE(22)).toBe(2);
  expect(wavBytes.readUInt32LE(24)).toBe(RATE);
  expect(wavBytes.readUInt16LE(34)).toBe(16);
  expect(wavBytes.toString('ascii', 36, 40)).toBe('data');
  const dataBytes = wavBytes.readUInt32LE(40);
  expect(dataBytes).toBe(wavBytes.length - 44);
  expect(Math.abs(dataBytes / 4 / RATE - wav.durationSeconds)).toBeLessThanOrEqual(1 / RATE);

  const flacBytes = checkedBytes(flac);
  expect(flac.mimeType).toBe('audio/flac');
  expect(flacBytes.toString('ascii', 0, 4)).toBe('fLaC');
  const decoded = decodeFlac(new Uint8Array(flacBytes.buffer, flacBytes.byteOffset, flacBytes.byteLength));
  expect(decoded.md5).toBe(decoded.info.md5);
  expect(decoded.info).toMatchObject({ sampleRate: RATE, channels: 2, bits: 16 });
  expect(Math.abs(decoded.info.totalSamples / RATE - flac.durationSeconds)).toBeLessThanOrEqual(1 / RATE);
  expect(flacBytes.length).toBeLessThan(wavBytes.length);

  // Same render, two encodings: every sample must match.
  expect(decoded.info.totalSamples).toBe(dataBytes / 4);
  const [left, right] = decoded.channels;
  for (let frame = 0; frame < decoded.info.totalSamples; frame += 1) {
    const at = 44 + frame * 4;
    if (left[frame] !== wavBytes.readInt16LE(at) || right[frame] !== wavBytes.readInt16LE(at + 2)) {
      throw new Error(`FLAC and WAV differ at frame ${frame}`);
    }
  }

  testInfo.annotations.push({
    type: 'export numbers',
    description: JSON.stringify({
      seconds: Number(flac.durationSeconds.toFixed(2)),
      wav: { bytes: wavBytes.length, ms: Math.round(wav.elapsedMs), longestStallMs: Math.round(wav.longestStallMs) },
      flac: { bytes: flacBytes.length, ms: Math.round(flac.elapsedMs), longestStallMs: Math.round(flac.longestStallMs) },
    }),
  });
  console.info('export numbers', testInfo.annotations.at(-1)?.description);
  // FLAC encodes and checks in slices that yield to the page, so it never stalls it for long.
  expect(flac.longestStallMs).toBeLessThan(2000);
});

test('a cancelled long export hands back no file', async ({ page }) => {
  test.setTimeout(300_000);
  for (const format of ['wav', 'flac'] as const) {
    const result = await exportIn(page, format, 300);
    expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
    expect('base64' in result).toBe(false);
  }
});
