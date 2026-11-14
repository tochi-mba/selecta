import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/src/testsupport/browser/fixture.html');
  await expect(page.getByRole('heading', { name: /browser acceptance laboratory/i })).toBeVisible();
});

test('actual AudioWorklet processes real offline PCM', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.getByRole('button', { name: 'Unlock test audio' }).click();
  await expect(page.locator('#result')).toContainText('AudioWorklet callbacks:');
  const evidence = await page.evaluate(() => (window as any).__selectaBrowserQA.probe());
  expect(evidence.worklet).toBe(true);
  expect(evidence.physicalOutputVerified).toBe(false);
  expect(failures).toEqual([]);
});

test('actual decodeAudioData covers 22.05/44.1/48 kHz mono and stereo WAV', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const qa = (window as any).__selectaBrowserQA;
    const out = [];
    for (const rate of [22050, 44100, 48000]) for (const channels of [1, 2]) {
      const decoded = await qa.decode(qa.syntheticWav({ sampleRate: rate, channels }));
      out.push({ requestedRate: rate, requestedChannels: channels, ...decoded });
    }
    return out;
  });
  expect(results).toHaveLength(6);
  for (const item of results) {
    expect(item.channels).toBe(item.requestedChannels);
    expect(item.peak).toBeGreaterThan(0.1);
    expect(item.nonzero).toBeGreaterThan(0);
    expect(item.duration).toBeGreaterThan(0.29);
    expect(item.physicalOutputVerified).toBe(false);
    // Browsers resample at AudioContext's actual device rate; never require decoded rate == source rate.
  }
});

test('silence, clipped PCM, wrong master and corrupt RIFF are not silently treated as verified media', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const qa = (window as any).__selectaBrowserQA;
    const silence = await qa.decode(qa.syntheticWav({ silence: true }));
    const clipped = await qa.decode(qa.syntheticWav({ clip: true }));
    const normal = await qa.decode(qa.syntheticWav({ frequency: 440 }));
    const wrong = await qa.decode(qa.syntheticWav({ frequency: 440, alternateMaster: true }));
    let corruptRejected = false;
    try { await qa.decode(new Uint8Array([0, 1, 2, 3, 4]).buffer); }
    catch { corruptRejected = true; }
    return { silence, clipped, normal, wrong, corruptRejected };
  });
  expect(report.silence.nonzero).toBe(0);
  expect(report.clipped.peak).toBeGreaterThan(0.99);
  expect(report.normal.peak).toBeLessThan(0.99);
  expect(report.wrong.nonzero).toBeGreaterThan(0);
  expect(report.corruptRejected).toBe(true);
  // Frequency/master identity requires Agent 02's canonical hashing contract; this test never certifies it.
});

test('real codec decoding records platform results without claiming missing codecs pass', async ({ page }, testInfo) => {
  const names = ['mono-44100.wav', 'stereo-48000.wav', 'sample.mp3',
    'sample.m4a', 'sample.flac', 'sample.opus'];
  const report = await page.evaluate(async (names) => {
    return Promise.all(names.map((name) => (window as any).__selectaBrowserQA.codecFetch(name)));
  }, names);
  testInfo.attach('codec-evidence', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  for (const entry of report) {
    expect(entry.outcome, entry.codec).not.toBe('fixture_missing');
  }
  expect(report[0].outcome).toBe('decoded');
  expect(report[1].outcome).toBe('decoded');
  // A missing optional decoder remains a release-gate failure in the coverage report, not a fake pass.
});

test('selection works through a real browser file picker contract without network upload', async ({ page }) => {
  const requestPaths: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') requestPaths.push(request.url());
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'owner.wav', mimeType: 'audio/wav',
    buffer: Buffer.from([82, 73, 70, 70, 0, 0, 0, 0]),
  });
  const selection = await page.evaluate(() => (window as any).__selectaBrowserQA.fileSelection());
  expect(selection).toMatchObject({
    selected: true, name: 'owner.wav', byteLength: 8,
    firstBytes: [82, 73, 70, 70], physicalOutputVerified: false,
  });
  expect(requestPaths).toEqual([]);
});
