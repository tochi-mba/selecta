import { expect, Page, test } from '@playwright/test';
import { PAGES, resetMix, stickingOut } from './helpers';

/**
 * ADR-0070 (S3-0070-08): the interface has no translations yet, so this is the pseudo-localised run.
 * Every word on each page is swapped for an accented copy about 40% longer (the usual allowance for
 * German or Finnish), with brackets that show where a string was cut. Song metadata carries long,
 * right-to-left and duplicate names from tests/e2e_server.py. At the smallest phone width and on a
 * desktop, nothing may stick out of the window, and no button, tab, link or heading may be clipped
 * without an ellipsis.
 */

const WIDTHS = [
  { width: 320, height: 640 },
  { width: 1280, height: 800 },
];

/** Lengthens every visible string, label and placeholder on the page, the way a pseudo-locale would. */
async function pseudoLocalise(page: Page): Promise<number> {
  return page.evaluate(() => {
    const accents: Record<string, string> = {
      a: 'å', e: 'é', i: 'ï', o: 'ö', u: 'ü', c: 'ç', n: 'ñ', y: 'ý', s: 'š', z: 'ž',
      A: 'Å', E: 'É', I: 'Ï', O: 'Ö', U: 'Ü', C: 'Ç', N: 'Ñ', Y: 'Ý', S: 'Š', Z: 'Ž',
    };
    const longer = (text: string) => {
      const core = text.trim();
      if (!core || !/[A-Za-z]/.test(core)) return text;
      const extra = '·'.repeat(Math.max(2, Math.ceil(core.length * 0.4)));
      const swapped = core.replace(/[A-Za-z]/g, (letter) => accents[letter] ?? letter);
      return text.replace(core, `[${swapped}${extra}]`);
    };
    let changed = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      if (node.parentElement?.closest('script, style, svg, audio, video')) continue;
      const next = longer(node.nodeValue ?? '');
      if (next !== node.nodeValue) { node.nodeValue = next; changed += 1; }
    }
    for (const element of document.querySelectorAll<HTMLElement>('[aria-label], [placeholder], [title]')) {
      for (const name of ['aria-label', 'placeholder', 'title']) {
        const value = element.getAttribute(name);
        if (value) element.setAttribute(name, longer(value));
      }
    }
    return changed;
  });
}

/** Controls and headings whose lengthened words are cut off with no ellipsis to say so. */
async function clipped(page: Page, where: string): Promise<string[]> {
  return page.evaluate((place) => {
    const found: string[] = [];
    const selector = 'button, a, [role="tab"], [role="menuitem"], label, h1, h2, h3, summary, .pill, .status';
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!box.width || !box.height || style.visibility === 'hidden' || element.closest('[aria-hidden="true"]')) continue;
      // a screen-reader-only label is deliberately clipped to one pixel
      if (style.clipPath !== 'none' || style.clip !== 'auto' || box.width <= 2) continue;
      const hides = ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflow);
      if (hides && style.textOverflow !== 'ellipsis' && element.scrollWidth > element.clientWidth + 1) {
        found.push(`${place}: ${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 40)}" is cut off`);
      }
    }
    return found;
  }, where);
}

test.beforeEach(async ({ request }) => resetMix(request, [8, 5, 6, 10, 11]));

for (const size of WIDTHS) {
  test(`S3-0070-08 pseudo-localised interface strings, 40% longer, fit every page at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize(size);
    const found: string[] = [];
    for (const address of PAGES) {
      await page.goto(address);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await page.waitForTimeout(300);
      const changed = await pseudoLocalise(page);
      expect(changed, `${address} has words to lengthen`).toBeGreaterThan(5);
      await page.waitForTimeout(100);
      found.push(...await stickingOut(page, `${address} at ${size.width}px`));
      found.push(...await clipped(page, `${address} at ${size.width}px`));
    }
    expect(found).toEqual([]);
  });
}
