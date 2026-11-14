import { expect, test } from '@playwright/test';

/** API/viewport smoke only; emulation DOES NOT certify an iPhone, iPad or Galaxy. */
test.describe('BR64-05 browser render prerequisites', () => {
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1366, height: 768 }]) {
    test(`portable browser surfaces at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.setContent('<main style="max-width:500px;width:100%;box-sizing:border-box;padding:12px"><h1>Local export</h1><button>Render locally</button><progress max="100" value="10"></progress></main>');
      await expect(page.getByRole('button', { name: 'Render locally' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const capability = await page.evaluate(() => ({
        webAudio: typeof AudioContext === 'function',
        offline: typeof OfflineAudioContext === 'function',
        storage: !!navigator.storage?.estimate,
        opfs: !!navigator.storage?.getDirectory,
      }));
      expect(capability.webAudio).toBe(true);
      expect(capability.offline).toBe(true);
      expect(capability.storage).toBe(true);
      // OPFS may be absent on a given browser; runtime must display unsupported.
    });
  }
});
