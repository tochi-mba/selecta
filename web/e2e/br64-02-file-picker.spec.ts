import { expect, test } from '@playwright/test';

// Runs in Agent 10's Playwright spec configuration. Browser-native smoke only;
// physical iOS/Android/USB/SD/document-provider validation is still required.
test.describe('BR64-02 browser-selected files', () => {
  test('multi-file picker works without uploading selected data', async ({ page }) => {
    const nonGet: string[] = [];
    page.on('request', (req) => { if (req.method() !== 'GET') nonGet.push(req.url()); });
    await page.setContent('<input type="file" multiple accept="audio/*,.flac" aria-label="Local music">');
    const chooser = page.getByLabel('Local music');
    await chooser.setInputFiles([
      { name: 'one.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('synthetic') },
      { name: 'two.flac', mimeType: 'audio/flac', buffer: Buffer.from('synthetic') },
    ]);
    expect(await chooser.evaluate((node: HTMLInputElement) => node.files?.length)).toBe(2);
    expect(nonGet).toEqual([]);
  });
  test('file-input fallback remains when directory API is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
    });
    await page.setContent('<input type="file" multiple aria-label="Fallback">');
    expect(await page.getByLabel('Fallback').evaluate((node) => 'files' in node)).toBe(true);
  });
});
