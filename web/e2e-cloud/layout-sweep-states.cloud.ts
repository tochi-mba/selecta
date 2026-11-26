import { expect, Page, test } from '@playwright/test';
import { rewriteJson } from '../e2e/helpers';
import { barStates, escapeAll, failAnswers, holdAnswers, pressIfThere, sweep, sweepStates, verdict, type SweepState } from '../e2e/layoutSweep';
import { listener } from './cloud';
import { seeded } from './localFirst';
import { amend, localFirstMember, opened } from './sweepMembers';

// The Cloud layout sweep, part two (e2e/layoutSweep.ts says what is measured): the states a route
// alone does not reach. The bars' drawers, sheets and menus; a song's details and the selection
// bar; the Library empty, loading and failing; many notices at once, folded and open, offline; and
// the hosted shell's More and account menu. With cloud.page_layout off and on.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/** Every list in an answer, emptied: the page's empty state. */
function emptied(body: unknown): unknown {
  if (Array.isArray(body)) return [];
  if (body && typeof body === 'object') return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, key === 'total' ? 0 : emptied(value)]));
  return body;
}

/** A song's details and the selection bar, on a Library with rows. */
function libraryStates(page: Page): SweepState[] {
  const box = () => page.locator('.library-rows input[type="checkbox"]').first();
  return [
    { name: 'song details', open: async () => { await pressIfThere(page, '.library-rows button.song-open'); }, close: () => escapeAll(page) },
    {
      name: 'selection bar',
      open: async () => { if (await box().isVisible().catch(() => false) && !(await box().isChecked())) await box().check().catch(() => undefined); },
      close: async () => { if (await box().isChecked().catch(() => false)) await box().uncheck().catch(() => undefined); },
    },
  ];
}

for (const layout of [false, true]) {
  const label = layout ? 'layout-on' : 'layout-off';

  test(`the bars’ drawers and menus, a song’s details and the selection bar, cloud.page_layout ${layout ? 'on' : 'off'}`, async ({ page, request }, testInfo) => {
    test.setTimeout(600_000);
    await localFirstMember(page, request, `sweep-states-${label}`, layout);
    await opened(page, '/library', 'Library');
    await verdict(testInfo, await sweepStates(page, testInfo, 'site.cloud.local.library', [...barStates(page), ...libraryStates(page)], { frame: layout, label }));
  });

  test(`the Library empty, loading and failing, cloud.page_layout ${layout ? 'on' : 'off'}`, async ({ page, request }, testInfo) => {
    test.setTimeout(600_000);
    await localFirstMember(page, request, `sweep-empty-${label}`, layout);
    const problems: string[] = [];
    await page.route('**/api/local-media/songs**', (route) => (route.request().method() === 'GET' ? rewriteJson(route, emptied) : route.fallback()));
    await opened(page, '/library', 'Library');
    problems.push(...(await sweep(page, testInfo, 'site.cloud.local.library empty', { frame: layout, label })));
    await page.unroute('**/api/local-media/songs**');
    await failAnswers(page, '**/api/local-media/songs**');
    await opened(page, '/library', 'Library');
    problems.push(...(await sweep(page, testInfo, 'site.cloud.local.library failing', { frame: layout, label })));
    await page.unroute('**/api/local-media/songs**');
    await holdAnswers(page, '**/api/local-media/songs**');
    await page.goto('/library');
    await page.waitForTimeout(1_000);
    problems.push(...(await sweep(page, testInfo, 'site.cloud.local.library loading', { frame: layout, label })));
    await verdict(testInfo, problems);
  });

  test(`many notices, folded and open, then offline, cloud.page_layout ${layout ? 'on' : 'off'}`, async ({ page, request }, testInfo) => {
    test.setTimeout(600_000);
    const user = await localFirstMember(page, request, `sweep-stack-${label}`, layout);
    const quota = await request.post('/test/quota', { data: { user, limit_bytes: 1 } });
    expect(quota.ok(), await quota.text()).toBeTruthy();
    await opened(page, '/listen', 'Listen');
    const more = page.locator('.shell-banners > .notice-more');
    const problems = await sweepStates(page, testInfo, 'site.cloud.local.listen notices', [
      { name: 'folded', open: async () => undefined },
      {
        name: 'open',
        open: async () => { if ((await more.getAttribute('aria-expanded').catch(() => null)) !== 'true') await pressIfThere(page, more); },
        close: async () => { if ((await more.getAttribute('aria-expanded').catch(() => null)) === 'true') await pressIfThere(page, more); },
      },
    ], { frame: layout, label });
    await page.context().setOffline(true);
    await page.waitForTimeout(1_500);
    problems.push(...(await sweep(page, testInfo, 'site.cloud.local.listen offline', { frame: layout, label })));
    await page.context().setOffline(false);
    await verdict(testInfo, problems);
  });
}

test('the hosted shell’s drawers and menus', async ({ page, request }, testInfo) => {
  test.setTimeout(600_000);
  const user = listener('sweep-hosted-states');
  await seeded(request, user, { songs: 2 });
  await page.addInitScript((who) => localStorage.setItem('selecta-e2e-user', who), user);
  await amend(page, { localFirst: false, layout: true });
  await opened(page, '/library');
  await verdict(testInfo, await sweepStates(page, testInfo, 'cloud.hosted.library', barStates(page), { frame: true, label: 'layout-on' }));
});
