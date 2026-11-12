import { expect, test, type Page } from '@playwright/test';
import { resetMix } from '../e2e/helpers';
import { settle, shot, STRESS_MIX, writeJson } from './shared';

const PATHS = [['/listen', 'listen'], ['/mixes', 'explore'], ['/mix/current/edit', 'editor'], ['/library', 'library'], ['/workshop/sources', 'sources'], ['/discover/harmonic', 'harmonic']] as const;

test.beforeAll(async ({ request }) => { await resetMix(request, STRESS_MIX); });

/** Geometry of the always-on chrome: bottom nav, mini-player, transport; and small touch targets. */
const geometry = (page: Page) => page.evaluate(() => {
  const box = (sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) };
  };
  const touchSmall: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('nav a, nav button, .mini-player button, .transport button, [role="tab"]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || el.closest('[aria-hidden="true"], [inert]')) continue;
    if (r.width < 44 || r.height < 44) touchSmall.push(`"${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const fixedBottoms = [...document.querySelectorAll<HTMLElement>('body *')].filter((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().bottom >= innerHeight - 2).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} top=${Math.round(e.getBoundingClientRect().top)}`);
  const main = document.querySelector('main');
  const pad = main ? getComputedStyle(main).paddingBottom : '';
  return {
    vw: innerWidth, vh: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    nav: box('nav'), mini: box('.mini-player, .mini'), main: box('main'), mainPadBottom: pad,
    fixedBottoms, touchSmall: touchSmall.slice(0, 15), touchSmallCount: touchSmall.length,
    safeArea: getComputedStyle(document.body).paddingBottom,
  };
});

test('devices', async ({ page }, info) => {
  const project = info.project.name;
  const report: Record<string, unknown> = { userAgent: await page.evaluate(() => navigator.userAgent).catch(() => '') };
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const [path, id] of PATHS) {
      try {
        await page.goto(path); await settle(page);
        if (theme === 'light' || id === 'listen') await shot(page, 'devices', `${project}-${theme}-${id}`);
        report[`${theme}-${id}`] = await geometry(page);
      } catch (error) { report[`${theme}-${id}`] = { error: String(error).slice(0, 300) }; }
    }
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  // Touch: open and close the Requests drawer by tapping.
  try {
    await page.goto('/listen'); await settle(page);
    const open = page.getByRole('button', { name: /^Requests/ }).first();
    if (info.project.use.hasTouch) await open.tap(); else await open.click();
    const drawer = page.getByRole('dialog', { name: /Requests/ });
    await expect(drawer).toBeVisible();
    await shot(page, 'devices', `${project}-light-requests`);
    const search = drawer.getByRole('searchbox').or(drawer.getByRole('textbox')).first();
    let searchVisible = false;
    if (await search.count()) { await search.click(); await search.fill('Same'); await page.waitForTimeout(800); searchVisible = await search.isVisible(); }
    const close = page.getByRole('button', { name: 'Close Requests', exact: true });
    if (info.project.use.hasTouch) await close.tap(); else await close.click();
    report.requestsTouch = { opened: true, searchVisible, closed: !(await drawer.isVisible()) };
  } catch (error) { report.requestsTouch = { error: String(error).slice(0, 300) }; }
  // Non-drag reorder in the editor.
  try {
    await page.goto('/mix/current/edit'); await settle(page);
    const ups = page.getByRole('button', { name: /^Move .* (up|down)$/ });
    const count = await ups.count();
    const first = page.getByRole('button', { name: /^Move .* down$/ }).first();
    const box = await first.boundingBox();
    const label = await first.getAttribute('aria-label');
    if (info.project.use.hasTouch) await first.tap(); else await first.click();
    await page.waitForTimeout(800);
    report.reorder = { buttons: count, firstBox: box, pressed: label, after: await page.getByRole('button', { name: /^Move .* down$/ }).first().getAttribute('aria-label') };
  } catch (error) { report.reorder = { error: String(error).slice(0, 300) }; }
  // Playing on the phone: mini-player vs nav.
  try {
    await page.goto('/library'); await settle(page);
    await page.goto('/listen'); await settle(page);
    await page.locator('.now .transport .primary').click();
    await page.waitForTimeout(1200);
    await page.goto('/library'); await settle(page);
    await shot(page, 'devices', `${project}-light-library-playing`);
    report.playingLibrary = await geometry(page);
  } catch (error) { report.playingLibrary = { error: String(error).slice(0, 300) }; }
  writeJson('devices', `${project}.json`, report);
});
