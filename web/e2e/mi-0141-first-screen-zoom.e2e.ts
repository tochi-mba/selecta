import { expect, test, type Page } from '@playwright/test';

/**
 * MI-0141-07: on the first screen, the folder field, what is wrong with a folder and the Start button
 * stay on screen and usable on a phone, with an on-screen keyboard taking the bottom of the window, and
 * at 200% and 400% zoom (a 1280x1024 window at 200% is 640x512 CSS pixels, at 400% it is 320x256).
 * The keyboard is modelled by shrinking the visible height the way a phone's visual viewport shrinks;
 * a real on-screen keyboard on a real phone needs a person.
 */
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone, keyboard up', width: 390, height: 844 - 336 },
  { name: 'phone landscape, keyboard up', width: 844, height: 390 - 200 },
  { name: '200%', width: 640, height: 512 },
  { name: '400%', width: 320, height: 256 },
] as const;

/** The first run, with the rest of the server left real. */
async function asIfNothingAdded(page: Page) {
  await page.route('**/api/status', async (route) => {
    const answer = await route.fetch();
    const status = await answer.json();
    await route.fulfill({ response: answer, json: { ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 } } });
  });
  await page.route('**/api/folders/check*', (route) =>
    route.fulfill({ json: { ok: false, kind: 'missing', reason: 'That folder isn’t there.' } }));
}

/** True when the element is wholly inside the window, with nothing on top of its middle. */
async function onScreen(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const element = document.querySelector<HTMLElement>(sel);
    if (!element) return { ok: false, why: 'missing' };
    const box = element.getBoundingClientRect();
    const inside = box.width > 0 && box.height > 0 && box.left >= -0.5 && box.top >= -0.5
      && box.right <= window.innerWidth + 0.5 && box.bottom <= window.innerHeight + 0.5;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const uncovered = !!hit && (hit === element || element.contains(hit));
    return { ok: inside && uncovered, why: inside ? (uncovered ? '' : 'covered') : 'outside the window' };
  }, selector);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await asIfNothingAdded(page);
});

for (const size of SIZES) {
  test(`MI-0141-07 the folder field, its problem and Start stay visible and usable: ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    const field = page.getByRole('textbox', { name: 'Music folder' });
    await expect(field).toBeVisible();
    await field.focus();
    await field.fill('C:\\Users\\you\\Music\\a folder that is not there');

    // typing keeps the field itself in view, and the page never scrolls sideways
    expect(await onScreen(page, '.page.start input')).toEqual({ ok: true, why: '' });
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sideways, 'no sideways scroll').toBeLessThanOrEqual(1);

    // Start is reachable by keyboard and by touch where it is
    const start = page.getByRole('button', { name: 'Start' });
    await start.scrollIntoViewIfNeeded();
    expect(await onScreen(page, '.page.start button.primary')).toEqual({ ok: true, why: '' });
    await field.press('Enter');

    // the problem is said, tied to the field, and can be brought into view beside it
    const problem = page.getByText('That folder isn’t there.');
    await expect(problem).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const described = await field.getAttribute('aria-describedby');
    expect(described, 'the field names its error').toBeTruthy();
    await problem.scrollIntoViewIfNeeded();
    const problemBox = await problem.boundingBox();
    expect(problemBox && problemBox.y >= 0 && problemBox.y + problemBox.height <= size.height + 0.5,
      'the problem fits on screen').toBeTruthy();

    // what was typed is kept, so the person can correct it rather than start again
    await expect(field).toHaveValue('C:\\Users\\you\\Music\\a folder that is not there');
    await field.focus();
    expect(await onScreen(page, '.page.start input')).toEqual({ ok: true, why: '' });
  });
}
