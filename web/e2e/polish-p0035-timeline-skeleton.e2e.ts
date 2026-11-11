import { expect, test, type Route } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * UI/UX polish ADR-0036 P0035: opening a draft on Edit holds song rows with transitions between them,
 * at the timeline's own geometry, so the loaded timeline lands where its placeholder was. The draft's
 * read is held by route until the placeholder has been measured. Unit proof of the shape:
 * web/src/ui/polishTimelineSkeleton.test.tsx.
 */

const DRAFT = /\/api\/mix\?draft=\d+/;

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Other E2E tests change global flags; use the same baseline on every run.
  await request.post('/api/test/flags', { data: { flags: '' } });
  await resetMix(request);
});

test('P0035 the Edit timeline placeholder matches the loaded timeline’s rows and edges', async ({ page, request }) => {
  const made = await (await request.post('/api/drafts', { data: { name: 'Placeholder check' } })).json();
  for (const song of [5, 6, 7]) await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: song } });
  try {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const held: Route[] = [];
      await page.route(DRAFT, (route) => void held.push(route));
      await page.goto(`/mixes/drafts/${made.id}/edit`);
      const skeleton = page.locator('main .skeleton-timeline[aria-label="Opening your draft"]');
      await expect(skeleton).toHaveAttribute('data-revealed', 'true');
      const placeholder = await skeleton.evaluate((node) => ({
        kinds: [...node.querySelectorAll('.skeleton-content > .skeleton-unit')].map((unit) => (unit.classList.contains('skeleton-song') ? 'song' : 'seam')),
        song: node.querySelector('.skeleton-song')!.getBoundingClientRect().toJSON(),
        seam: node.querySelector('.skeleton-seam')!.getBoundingClientRect().toJSON(),
        text: (node.querySelector('.skeleton-content') as HTMLElement).innerText.trim(),
      }));
      await page.unroute(DRAFT);
      for (const route of held.splice(0)) await route.fallback();
      const firstSong = page.locator('.timeline > .song').first();
      await expect(firstSong).toBeVisible();
      const loaded = await page.evaluate(() => ({
        song: document.querySelector('.timeline > .song')!.getBoundingClientRect().toJSON(),
        seam: document.querySelector('.timeline > .seam')!.getBoundingClientRect().toJSON(),
      }));
      const at = `${width}px`;
      expect(placeholder.text, `${at}: shapes only`).toBe('');
      expect(placeholder.kinds.slice(0, 3), `${at}: song, transition, song`).toEqual(['song', 'seam', 'song']);
      // same left edge and width as the real rows, and heights within one row of padding
      expect(Math.abs(placeholder.song.left - loaded.song.left), `${at}: song left`).toBeLessThanOrEqual(24);
      expect(Math.abs(placeholder.song.height - loaded.song.height), `${at}: song height`).toBeLessThanOrEqual(24);
      expect(placeholder.seam.left, `${at}: transition hangs to the right of the song edge`).toBeGreaterThan(placeholder.song.left);
      expect(Math.abs(placeholder.seam.height - loaded.seam.height), `${at}: transition height`).toBeLessThanOrEqual(32);
    }
  } finally {
    await request.delete(`/api/drafts/${made.id}`);
  }
});
