import { expect, test } from '@playwright/test';
import { listener, signedIn } from './cloud';

// SC-0399-02: every engine decodes the production-format FLAC proxy onto the same sample
// boundary as the uploaded source. This deliberately compares decoded PCM rather than media
// element currentTime, whose precision and scheduling differ between browsers.
test('the lossless playback proxy begins on the source sample in every browser engine', async ({
  browserName,
  page,
  request,
}) => {
  const seeded = await signedIn(page, request, listener(`alignment-${browserName}`), {
    songs: 1,
    seconds: 2,
    path: '/library',
    realProxy: true,
  });
  await page.getByRole('button', { name: 'Listen to Song 1.wav' }).click();
  const audio = page.locator('audio');
  // Direct signed FLAC URLs and object URLs must decode to the same PCM below.
  await expect.poll(() => audio.getAttribute('src')).toMatch(/^(blob:|https?:\/\/.*\/proxy\.flac(?:\?|$))/);
  const proxyUrl = await audio.getAttribute('src');
  expect(proxyUrl).toBeTruthy();

  const result = await page.evaluate(async ({ assetId, proxy }) => {
    const [sourceBytes, proxyBytes] = await Promise.all([
      fetch(`/test/original-audio/${encodeURIComponent(assetId)}`).then((response) => response.arrayBuffer()),
      fetch(proxy).then((response) => response.arrayBuffer()),
    ]);
    const context = new AudioContext({ sampleRate: 44_100 });
    try {
      const [source, playback] = await Promise.all([
        context.decodeAudioData(sourceBytes),
        context.decodeAudioData(proxyBytes),
      ]);
      const wanted = source.getChannelData(0);
      const found = playback.getChannelData(0);
      const errors = [];
      for (let shift = -4; shift <= 4; shift += 1) {
        const sourceAt = Math.max(0, -shift);
        const proxyAt = Math.max(0, shift);
        const count = Math.min(wanted.length - sourceAt, found.length - proxyAt, 44_100);
        let squared = 0;
        for (let index = 0; index < count; index += 1) {
          const difference = wanted[sourceAt + index] - found[proxyAt + index];
          squared += difference * difference;
        }
        errors.push({ shift, meanSquared: squared / count });
      }
      errors.sort((left, right) => left.meanSquared - right.meanSquared);
      return {
        sourceRate: source.sampleRate,
        proxyRate: playback.sampleRate,
        sourceLength: wanted.length,
        proxyLength: found.length,
        best: errors[0],
      };
    } finally {
      await context.close();
    }
  }, { assetId: seeded.assets[0], proxy: proxyUrl! });

  expect(result.sourceRate).toBe(44_100);
  expect(result.proxyRate).toBe(44_100);
  expect(result.proxyLength).toBe(result.sourceLength);
  expect(result.best.shift).toBe(0);
  expect(result.best.meanSquared).toBeLessThan(1e-9);
});
