import { expect, test, type Page } from '@playwright/test';

/**
 * Browser-native acceptance against Vite, not the Python E2E server.
 * Run with a separate Vite server: cd web && pnpm dev --host 127.0.0.1.
 * Test discovery/config integration belongs to Agent 10. These tests use
 * real browser decoding and AudioWorklet with synthetic WAV, not device speakers.
 */
test.use({ baseURL: process.env.SELECTA_BR64_VITE_URL ?? 'http://127.0.0.1:5173' });

async function seedLocalEngine(page: Page, workspace: string) {
  await page.goto('/cloud-harness.html');
  await page.evaluate(async (id) => {
    const { BrowserAudioRuntime } = await import('/src/engine/BrowserAudioRuntime.ts');
    const sineFile = (name: string, frequency: number) => {
      const rate = 44100, count = rate * 2;
      const bytes = new ArrayBuffer(44 + count * 2);
      const data = new DataView(bytes);
      const fourcc = (offset: number, name: string) => {
        for (let i = 0; i < name.length; i++) data.setUint8(offset + i, name.charCodeAt(i));
      };
      fourcc(0, 'RIFF'); data.setUint32(4, 36 + count * 2, true);
      fourcc(8, 'WAVE'); fourcc(12, 'fmt '); data.setUint32(16, 16, true);
      data.setUint16(20, 1, true); data.setUint16(22, 1, true);
      data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true);
      data.setUint16(32, 2, true); data.setUint16(34, 16, true);
      fourcc(36, 'data'); data.setUint32(40, count * 2, true);
      for (let i = 0; i < count; i++) {
        const sample = Math.sin(2 * Math.PI * frequency * i / rate) * 0.35;
        data.setInt16(44 + i * 2, Math.round(sample * 32767), true);
      }
      return new File([bytes], name, { type: 'audio/wav' });
    };
    const runtime = new BrowserAudioRuntime(id);
    (window as any).__br64 = runtime;
    await runtime.setQueue([
      { id: 'tone-440', title: '440 Hz locally generated', file: sineFile('a.wav', 440) },
      { id: 'tone-660', title: '660 Hz locally generated', file: sineFile('b.wav', 660) },
    ]);
    runtime.setFade(0.35);
    const trigger = document.createElement('button');
    trigger.id = 'br64-test-start';
    trigger.textContent = 'Tap start synthetic audio';
    trigger.onclick = () => { void runtime.play(); };
    document.body.appendChild(trigger);
  }, workspace);
}

test('real decoding + two-deck AudioWorklet path without media proxy', async ({ page }) => {
  let cloudAudioRequests = 0;
  await page.route('**/assets/**/playback-proxy', (route) => {
    cloudAudioRequests += 1;
    void route.abort();
  });
  await seedLocalEngine(page, 'br64-audio-test');
  await page.locator('#br64-test-start').click();
  await expect.poll(() => page.evaluate(() => (window as any).__br64.snapshot().phase)).toBe('playing');
  await page.evaluate(async () => { await (window as any).__br64.next(); });
  await expect.poll(() => page.evaluate(() => (window as any).__br64.snapshot().index)).toBe(1);
  expect(cloudAudioRequests).toBe(0);
  expect(await page.evaluate(() => (window as any).__br64.snapshot().soundCheck)).toBe('unverified');
  await page.evaluate(async () => {
    await (window as any).__br64.pause();
    await (window as any).__br64.seek(0.5);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__br64.snapshot().phase)).toBe('paused');
});

test('two browser tabs never both gain exclusive Web Locks speaker ownership', async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  try {
    await seedLocalEngine(a, 'br64-same-workspace');
    await seedLocalEngine(b, 'br64-same-workspace');
    await a.locator('#br64-test-start').click();
    await expect.poll(() => a.evaluate(() => (window as any).__br64.snapshot().phase)).toBe('playing');
    await b.locator('#br64-test-start').click();
    await expect.poll(() => b.evaluate(() => (window as any).__br64.snapshot().phase)).toBe('error');
    expect(await b.evaluate(() => (window as any).__br64.snapshot().error)).toContain('another tab');
    await a.evaluate(async () => { await (window as any).__br64.stop(); });
    await b.locator('#br64-test-start').click();
    await expect.poll(() => b.evaluate(() => (window as any).__br64.snapshot().phase)).toBe('playing');
  } finally {
    await context.close();
  }
});

test('interruption explicitly removes verified physical sound; mobile browser remains player eligible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seedLocalEngine(page, 'br64-mobile');
  await page.locator('#br64-test-start').click();
  await expect.poll(() => page.evaluate(() => (window as any).__br64.snapshot().phase)).toBe('playing');
  await page.evaluate(() => {
    (window as any).__br64.confirmSound(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__br64.snapshot().phase)).toBe('interrupted');
  expect(await page.evaluate(() => (window as any).__br64.snapshot().soundCheck)).toBe('unverified');
});
