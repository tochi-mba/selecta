import { writeFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * MI-0141-07: on the first screen, the folder field, what is wrong with a folder and Start stay on
 * screen, uncovered, with an on-screen keyboard up: on a 320x568 and a 375x667 touch phone, and at 200%
 * zoom (a 1280x1024 window is 640x512 CSS pixels, two device pixels each) with a docked touch keyboard.
 * At 400% (320x256 CSS pixels, four device pixels each) the window is too short to hold all three at
 * once with the field's help between them, so there each one is checked in turn as the keyboard reaches
 * it. The keyboard is modelled the way a phone reports it: the visual viewport gets shorter and fires
 * resize, while the layout viewport stays the same size. A real phone keyboard needs a person.
 */
type Case = { name: string; width: number; height: number; scale: number; touch: boolean; keyboard: number; together: boolean };
const CASES: Case[] = [
  { name: '320x568 touch phone', width: 320, height: 568, scale: 2, touch: true, keyboard: 260, together: true },
  { name: '375x667 touch phone', width: 375, height: 667, scale: 2, touch: true, keyboard: 260, together: true },
  // a docked touch keyboard of 300 device pixels is 150 CSS pixels at 200%
  { name: '200% zoom', width: 640, height: 512, scale: 2, touch: true, keyboard: 150, together: true },
  { name: '400% zoom', width: 320, height: 256, scale: 4, touch: false, keyboard: 0, together: false },
];
const TYPED = 'C:\\Users\\you\\Music\\a folder that is not there';
const REFUSED = 'That folder isn’t there.';

declare global {
  interface Window {
    keyboardTo: (height: number) => void;
  }
}

async function firstRun(browser: Browser, baseURL: string | undefined, size: Case) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    hasTouch: size.touch,
    isMobile: size.touch,
    reducedMotion: 'reduce',
  });
  // the visual viewport, as a phone reports it: shorter by whatever the keyboard covers
  await context.addInitScript(() => {
    let keyboard = 0;
    const events = new EventTarget();
    const view = {
      get width() { return window.innerWidth; },
      get height() { return Math.max(window.innerHeight - keyboard, 0); },
      offsetTop: 0,
      offsetLeft: 0,
      get pageTop() { return window.scrollY; },
      get pageLeft() { return window.scrollX; },
      scale: 1,
      onresize: null,
      onscroll: null,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => view });
    window.addEventListener('scroll', () => events.dispatchEvent(new Event('scroll')));
    window.keyboardTo = (height: number) => {
      keyboard = height;
      events.dispatchEvent(new Event('resize'));
    };
  });
  const page = await context.newPage();
  // the real server, answering as if no music had been added yet, and refusing the folder
  await page.route('**/api/status', async (route) => {
    const answer = await route.fetch();
    const status = await answer.json();
    await route.fulfill({ response: answer, json: { ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 }, scan: { status: 'idle' } } });
  });
  await page.route('**/api/folders/check*', (route) => route.fulfill({ json: { ok: false, kind: 'missing', reason: REFUSED } }));
  return { context, page };
}

/** Where each part is, against what can be seen above the keyboard, and whether anything sits on it. */
function where(page: Page, selectors: Record<string, string>) {
  return page.evaluate((parts) => {
    const seen = { top: 0, bottom: window.visualViewport!.height, right: window.innerWidth };
    return Object.entries(parts).map(([name, selector]) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return { name, problem: 'missing' };
      const box = element.getBoundingClientRect();
      const inside = box.height > 0 && box.top >= seen.top - 0.5 && box.bottom <= seen.bottom + 0.5 && box.left >= -0.5 && box.right <= seen.right + 0.5;
      // the middle and four points just inside each corner must all be this part, not something fixed on it
      const points = [[0.5, 0.5], [0.1, 0.2], [0.9, 0.2], [0.1, 0.8], [0.9, 0.8]].map(([x, y]) => [box.left + box.width * x, box.top + box.height * y]);
      const covered = points
        .map(([x, y]) => document.elementFromPoint(x, y))
        .filter((hit) => !hit || !(hit === element || element.contains(hit) || hit.contains(element)))
        .map((hit) => (hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing'));
      const problem = !inside ? `outside what can be seen (${Math.round(box.top)} to ${Math.round(box.bottom)} of ${Math.round(seen.bottom)})` : covered.length ? `covered by ${covered[0]}` : '';
      return { name, problem, top: Math.round(box.top), bottom: Math.round(box.bottom) };
    });
  }, selectors);
}

const PARTS = { field: '.page.start .field input', start: '.page.start .field button.primary', problem: '.page.start .field .warn' };
const settle = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

for (const size of CASES) {
  test(`MI-0141-07 the folder field, its problem and Start stay visible under the keyboard: ${size.name}`, async ({ browser, baseURL }, info) => {
    const { context, page } = await firstRun(browser, baseURL, size);
    const readings: unknown[] = [];
    try {
      await page.goto('/');
      const field = page.getByRole('textbox', { name: 'Music folder' });
      await expect(field).toBeVisible();
      // into the field the way a person gets there: a tap on a phone, Tab on a zoomed desktop
      if (size.touch) {
        await field.tap();
      } else {
        for (let presses = 0; presses < 20 && !(await field.evaluate((input) => input === document.activeElement)); presses += 1) await page.keyboard.press('Tab');
      }
      await expect(field).toBeFocused();
      if (size.keyboard) await page.evaluate((height) => window.keyboardTo(height), size.keyboard);
      await settle(page);
      const typing = await where(page, { field: PARTS.field, start: PARTS.start });
      readings.push({ moment: 'keyboard up, about to type', typing });
      for (const part of typing) expect(part.problem, `${size.name}, about to type: ${part.name}`).toBe('');

      // typed and sent from the keyboard itself, as Go or Enter does, without the test scrolling anything
      await page.keyboard.type(TYPED);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toHaveCount(1);
      await settle(page);
      await expect(field).toHaveValue(TYPED);
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      const errorId = await page.locator(PARTS.problem).getAttribute('id');
      expect((await field.getAttribute('aria-describedby'))?.split(' '), 'the problem is tied to the field').toContain(errorId);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'sideways scroll').toBeLessThanOrEqual(1);

      if (size.together) {
        const refused = await where(page, PARTS);
        readings.push({ moment: 'folder refused, keyboard still up', refused });
        for (const part of refused) expect(part.problem, `${size.name}, after the problem: ${part.name}`).toBe('');
        await expect(field).toBeFocused();
      } else {
        // the problem is brought into view the moment it is said; then the keyboard reaches the field
        // and Start in turn, and each is in view and uncovered when it is reached
        const told = await where(page, { problem: PARTS.problem });
        readings.push({ moment: 'folder refused', told });
        expect(told[0].problem, `${size.name}: the problem`).toBe('');
        for (const [name, keys] of [['start', 'Tab'], ['field', 'Shift+Tab']] as const) {
          await page.keyboard.press(keys);
          await settle(page);
          await expect(page.locator(PARTS[name])).toBeFocused();
          const reached = await where(page, { [name]: PARTS[name] });
          readings.push({ moment: `${name} reached by keyboard`, reached });
          expect(reached[0].problem, `${size.name}: ${name} when reached`).toBe('');
        }
      }
    } finally {
      writeFileSync(info.outputPath('mi-0141-07-geometry.json'), JSON.stringify({ size, readings }, null, 2));
      await context.close();
    }
  });
}
