import { expect, test } from '@playwright/test';

// Browser primitive tests: synthetic OfflineAudioContext export, not product render parity.
test.beforeEach(async ({ page }) => {
  await page.goto('/src/testsupport/browser/fixture.html');
});

for (const [label, seconds, chunkSeconds] of [
  ['short', 2, 1],
  ['long', 61, 4],
] as const) {
  test(`browser local ${label} PCM export uses bounded real offline render chunks`, async ({ page }, info) => {
    const result = await page.evaluate(async ({ seconds, chunkSeconds }) => {
      const qa = (window as any).__selectaBrowserQA;
      const report = await qa.renderSyntheticWav({ seconds, chunkSeconds });
      if (!report.artifact) return { status: report.status };
      const decoded = await qa.decode(await report.artifact.arrayBuffer());
      return { status: report.status, chunks: report.completedChunks, renderingMs: report.renderingMs,
        artifactBytes: report.artifact.size, expectedSeconds: seconds,
        peak: report.peak, decodedDuration: decoded.duration,
        decodedPeak: decoded.peak, physicalOutputVerified: report.physicalOutputVerified };
    }, { seconds, chunkSeconds });
    await info.attach('local-offline-render-evidence', {
      body: JSON.stringify(result, null, 2), contentType: 'application/json',
    });
    expect(result.status).toBe('completed');
    expect(result.physicalOutputVerified).toBe(false);
    expect(result.chunks).toBeGreaterThan(1);
    expect(result.peak).toBeGreaterThan(0.1);
    expect(result.decodedPeak).toBeGreaterThan(0.1);
    expect(result.decodedDuration).toBeGreaterThan(seconds - 0.01);
    expect(result.decodedDuration).toBeLessThan(seconds + 0.01);
  });
}

test('chunk cancellation returns no artifact, never a claimed completed export', async ({ page }) => {
  const report = await page.evaluate(async () => {
    return (window as any).__selectaBrowserQA.renderSyntheticWav({
      seconds: 10, chunkSeconds: 2, cancelAfterChunks: 1,
    });
  });
  expect(report.status).toBe('cancelled');
  expect(report.completedChunks).toBe(1);
  expect(report.artifact).toBeNull();
  expect(report.physicalOutputVerified).toBe(false);
});

test('real browser storage estimate is recorded but cannot prove quota-pressure handling', async ({ page }, info) => {
  const state = await page.evaluate(async () => {
    const estimate = await navigator.storage?.estimate?.();
    return { estimatedQuota: estimate?.quota ?? null, estimatedUsage: estimate?.usage ?? null,
      physicalStoragePressureTested: false, productionRendererTested: false };
  });
  await info.attach('storage-observation', {
    body: JSON.stringify(state, null, 2), contentType: 'application/json',
  });
  expect(state.physicalStoragePressureTested).toBe(false);
  expect(state.productionRendererTested).toBe(false);
});
