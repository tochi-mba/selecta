import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * UF-0388-04 (code half): planned, ready, failed and selected are said in words or a shape, not
 * colour alone, so they survive forced colours and grayscale. Screenshots of each condition are
 * written for the person who listens to the spoken output and signs the visual review.
 */

const CONDITIONS = ['normal', 'forced colours', 'grayscale'] as const;

async function apply(page: Page, condition: (typeof CONDITIONS)[number]) {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: condition === 'forced colours' ? 'active' : 'none' });
  if (condition === 'grayscale') await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' });
}

test.beforeEach(async ({ request }) => resetMix(request));

test('UF-0388-04 planned, ready, failed and selected keep their words under forced colours and grayscale', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const condition of CONDITIONS) {
    // planned: each seam in the editor says its state in words
    await page.goto('/mix/current/edit');
    await apply(page, condition);
    const seams = page.locator('.timeline > .seam');
    await expect(seams.first()).toBeVisible();
    const words = await seams.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).innerText.trim()));
    for (const text of words) expect(text, `${condition}: a seam without words`).toMatch(/Not rendered yet|In line|Rendering|Ready|ready|made|plays/i);
    await page.screenshot({ path: info.outputPath(`uf-0388-04-editor-${condition.replace(' ', '-')}.png`) });

    // ready and failed: the Library names a broken song in words and offers it nothing to start
    await page.goto('/library');
    await apply(page, condition);
    await expect(page.locator('.library-count')).toBeVisible();
    const rows = page.locator('ul.library-rows > li');
    const broken = rows.filter({ hasText: 'Broken File' });
    await expect(broken.getByText('Couldn’t be analysed')).toBeVisible();
    await expect(broken.getByRole('button', { name: 'Start a mix' })).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Paper Moon' }).getByRole('button', { name: 'Start a mix' })).toBeVisible();

    // selected: a chosen filter is pressed for assistive technology and marked by a shape or edge
    const chosen = page.getByRole('button', { name: 'Needs attention' });
    await chosen.click();
    await expect(chosen).toHaveAttribute('aria-pressed', 'true');
    const mark = (name: string) => page.getByRole('button', { name, exact: true }).evaluate((node) => {
      const style = getComputedStyle(node);
      return `${style.boxShadow}|${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}|${style.outlineStyle}`;
    });
    expect(await mark('Needs attention'), `${condition}: the chosen filter looks like the others`).not.toBe(await mark('Ready'));
    await page.screenshot({ path: info.outputPath(`uf-0388-04-library-${condition.replace(' ', '-')}.png`) });
  }
});
