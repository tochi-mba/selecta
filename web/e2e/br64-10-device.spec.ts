import { expect, test } from '@playwright/test';

test('capabilities are probed, not inferred from phone/tablet or user agent labels', async ({ page }, info) => {
  await page.goto('/src/testsupport/browser/fixture.html');
  const capabilities = await page.evaluate(() => (window as any).__selectaBrowserQA.probe());
  expect(capabilities.secureContext).toBe(true);
  expect(capabilities.audioContext).toBe(true);
  expect(capabilities.fileInput).toBe(true);
  expect(capabilities.physicalOutputVerified).toBe(false);
  await info.attach('browser-capability-evidence', {
    body: JSON.stringify({
      project: info.project.name, browser: info.project.use.browserName,
      viewport: info.project.use.viewport, ...capabilities,
    }, null, 2), contentType: 'application/json',
  });
});

test('portrait, landscape, 200% zoom equivalent and reduced-motion can access controls', async ({ page }) => {
  await page.goto('/src/testsupport/browser/fixture.html');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const size of [{ width: 390, height: 844 }, { width: 1024, height: 768 },
    { width: 320, height: 640 }]) {
    await page.setViewportSize(size);
    await expect(page.locator('#local')).toBeVisible();
    await expect(page.locator('#unlock')).toBeVisible();
    await page.getByRole('button', { name: 'Unlock test audio' }).focus();
    await expect(page.getByRole('button', { name: 'Unlock test audio' })).toBeFocused();
  }
});

test('fixture makes no claims of venue output, long-run stability or physical hardware', async ({ page }) => {
  await page.goto('/src/testsupport/browser/fixture.html');
  await expect(page.locator('#evidence')).toContainText('not physical speaker certification');
  const probe = await page.evaluate(() => (window as any).__selectaBrowserQA.probe());
  expect(probe.testOnly).toBe(true);
  expect(probe.physicalOutputVerified).toBe(false);
});

test('production Cloud integration requires an explicit deployed target', async ({ page }, info) => {
  const target = process.env.SELECTA_BROWSER_CLOUD_URL;
  test.skip(!target, 'BLOCKED: no deployed Cloud URL: synthetic tests do not prove production.');
  if (!target) return;
  const outgoing: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (req.method() !== 'GET' && /\/(uploads\/plan|uploads\/[^/]+\/parts|cloud-assets|audio\/upload)/i.test(url)) outgoing.push(url);
  });
  await page.goto(target);
  await expect(page.locator('body')).toBeVisible();
  await info.attach('production-smoke-target', {
    body: JSON.stringify({ target, pageTitle: await page.title(), outgoing }, null, 2),
    contentType: 'application/json',
  });
  expect(outgoing).toEqual([]);
  // Integration owner must add authenticated media selection and playback assertions.
});
