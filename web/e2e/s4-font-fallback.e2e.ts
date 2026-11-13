import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * S4-0091-06: when the display and body faces are missing and the browser falls back, no button
 * clips its words, icons stay centred on their labels, and no action is an unlabelled icon. Each
 * fallback is applied by overriding the --display, --body and --mono tokens (the type roles are
 * built from them), and every route is captured as fallback-<face>-<route>.png in the output
 * folder for the owner's platform check.
 */
const FALLBACKS = [
  { id: 'system-ui', display: 'system-ui, sans-serif', body: 'Arial, sans-serif', mono: 'monospace' },
  { id: 'wide', display: 'Verdana, sans-serif', body: 'Verdana, sans-serif', mono: '"Courier New", monospace' },
] as const;
const ROUTES = ['/mixes', '/listen', '/mix/current/edit', '/library', '/workshop'] as const;

test.beforeEach(async ({ request }) => resetMix(request));

const settle = async (page: Page) => {
  await expect(page.locator('main#main:not([aria-busy="true"])').locator('h1, h2').first()).toBeVisible();
  await page.waitForTimeout(150);
};

type Problem = { what: string; where: string };

const problems = (page: Page) => page.evaluate((): Problem[] => {
  const found: Problem[] = [];
  const name = (node: Element) => `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]} "${(node.textContent ?? '').trim().slice(0, 40)}"`;
  const shown = (node: Element) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && !node.closest('[aria-hidden="true"], .visually-hidden');
  };
  for (const button of document.querySelectorAll<HTMLElement>('button, a.button, [role="tab"]')) {
    if (!shown(button)) continue;
    const style = getComputedStyle(button);
    const words = (button.textContent ?? '').trim();
    const label = button.getAttribute('aria-label') ?? button.getAttribute('title') ?? button.getAttribute('aria-labelledby');
    if (!words && !label) found.push({ what: 'icon-only action without a name', where: name(button) });
    // a clipped word: hidden overflow with nothing to show it was cut
    const clips = style.overflowX === 'hidden' || style.overflow === 'hidden';
    if (clips && style.textOverflow !== 'ellipsis' && button.scrollWidth > button.clientWidth + 1) {
      found.push({ what: `clips ${button.scrollWidth - button.clientWidth}px of its words`, where: name(button) });
    }
    if (clips && button.scrollHeight > button.clientHeight + 2) {
      found.push({ what: `clips ${button.scrollHeight - button.clientHeight}px of its glyphs`, where: name(button) });
    }
    const icon = button.querySelector('svg');
    const text = [...button.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
      ?? button.querySelector('span:not(.count):not(.visually-hidden)');
    if (icon && text && shown(icon)) {
      const range = document.createRange();
      range.selectNodeContents(text);
      const words = range.getBoundingClientRect();
      const mark = icon.getBoundingClientRect();
      if (words.height > 0 && words.height < mark.height * 2.5) {
        const offset = Math.abs((words.top + words.bottom) / 2 - (mark.top + mark.bottom) / 2);
        if (offset > 3) found.push({ what: `icon ${offset.toFixed(1)}px off its label's centre`, where: name(button) });
      }
    }
  }
  return found;
});

for (const face of FALLBACKS) {
  test(`with the ${face.id} fallback faces nothing clips, drifts or loses its name`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    const all: Problem[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await page.addStyleTag({ content: `:root:root:root { --display: ${face.display}; --body: ${face.body}; --mono: ${face.mono}; }` });
      await settle(page);
      expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(face.body.split(',')[0].replace(/"/g, ''));
      all.push(...(await problems(page)).map((problem) => ({ ...problem, where: `${route} ${problem.where}` })));
      await page.screenshot({ path: info.outputPath(`fallback-${face.id}-${route.replace(/\//g, '_')}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
    }
    expect(all).toEqual([]);
  });
}
