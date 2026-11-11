import { writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { allRendered, resetMix } from './helpers';

/**
 * ADR-0288 seam inspector: the selected pair, the four tabs, audition beside Good/Bad, the truth layers,
 * the editor's field rhythm, the resized rail and sheet, and the selection holding through async work.
 * Measured in Edge against tests/e2e_server.py; candidates for an independent reviewer, not a human sign-off.
 */
const LONG_A = 'An Extraordinarily Long Opening Song Title That Will Not Fit On One Line At All';
const LONG_B = 'Another Unreasonably Long Song Title, Still Going Well Past Any Phone Width';

const box = (locator: Locator) => locator.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
});

/** True when the centre of the element is what the page would actually click. */
const unobscured = (locator: Locator) => locator.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return !!hit && (hit === element || element.contains(hit));
});

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

async function openEditor(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/mix/current/edit');
  await expect(page.locator('main#main')).toBeVisible();
  await settle(page);
}

/** The inspector of the first transition, whichever form it takes at this width. */
async function openInspector(page: Page) {
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await expect(page.locator('.inspector-identity')).toBeVisible();
  await settle(page);
  return page.locator('.inspector').first();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0288-01 both exact songs and the transition number stay legible at narrow width', async ({ page, request }, info) => {
  await resetMix(request, [1, 2, 3]);
  // long titles, served for this page only, so the narrowest phone has something real to wrap
  await page.route('**/api/mix', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const answer = await route.fetch();
    const data = await answer.json();
    data.mix[0].title = LONG_A;
    data.mix[1].title = LONG_B;
    await route.fulfill({ response: answer, json: data });
  });
  const readings = [];
  for (const width of [320, 375, 768, 1440]) {
    await openEditor(page, width);
    const inspector = await openInspector(page);
    const pair = inspector.locator('.inspector-pair');
    await expect(pair.locator('b').nth(0)).toHaveText(LONG_A);
    await expect(pair.locator('b').nth(1)).toHaveText(LONG_B);
    await expect(inspector.locator('.inspector-number')).toHaveText('Transition 1');
    const panel = await box(inspector);
    const reading = await pair.evaluate((element) => {
      const names = [...element.querySelectorAll('b')].map((name) => {
        const rect = name.getBoundingClientRect();
        const style = getComputedStyle(name);
        return { left: rect.left, right: rect.right, fontSize: parseFloat(style.fontSize), clipped: name.scrollWidth > name.clientWidth + 1 && style.overflow !== 'visible' };
      });
      return { names, overflowX: element.scrollWidth - element.clientWidth };
    });
    for (const name of reading.names) {
      expect(name.left, `${width}px: a song name starts outside the inspector`).toBeGreaterThanOrEqual(panel.left - 1);
      expect(name.right, `${width}px: a song name runs past the inspector`).toBeLessThanOrEqual(panel.right + 1);
      expect(name.fontSize, `${width}px: a song name is too small to read`).toBeGreaterThanOrEqual(14);
      expect(name.clipped, `${width}px: a song name is cut off`).toBe(false);
    }
    expect(reading.overflowX, `${width}px: the pair scrolls sideways`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${width}px: page scrolls sideways`).toBeLessThanOrEqual(0);
    readings.push({ width, panel, ...reading });
  }
  writeFileSync(info.outputPath('mp-0288-01-pair.json'), JSON.stringify({ status: 'candidate-not-independently-verified', readings }, null, 2));
});

test('MP-0288-02 Listen, Change, Studio and Details share one geometry and tab semantics', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3]);
  for (const width of [320, 1440]) {
    await openEditor(page, width);
    const inspector = await openInspector(page);
    const tabs = inspector.getByRole('tab');
    await expect(tabs).toHaveText(['Listen', 'Change', 'Studio', 'Details']);
    const boxes = await tabs.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { top: rect.top, height: rect.height, fontSize: style.fontSize, fontWeight: style.fontWeight, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight };
    }));
    for (const one of boxes) {
      expect(Math.abs(one.top - boxes[0].top), `${width}px: tabs on different rows`).toBeLessThanOrEqual(1);
      expect(Math.abs(one.height - boxes[0].height), `${width}px: tab heights differ`).toBeLessThanOrEqual(1);
      expect(one.height, `${width}px: tab under the 44px target`).toBeGreaterThanOrEqual(44);
      expect([one.fontSize, one.fontWeight, one.paddingLeft, one.paddingRight]).toEqual([boxes[0].fontSize, boxes[0].fontWeight, boxes[0].paddingLeft, boxes[0].paddingRight]);
    }
    // one tab stop; the arrows, Home and End move the selection and the focus together
    await tabs.nth(0).focus();
    const expectSelected = async (name: string) => {
      const tab = inspector.getByRole('tab', { name, exact: true });
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(tab).toBeFocused();
      await expect(tab).toHaveAttribute('tabindex', '0');
      await expect(inspector.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
      const panel = inspector.getByRole('tabpanel');
      await expect(panel).toHaveAttribute('aria-labelledby', (await tab.getAttribute('id'))!);
    };
    await page.keyboard.press('ArrowRight');
    await expectSelected('Change');
    await page.keyboard.press('End');
    await expectSelected('Details');
    await page.keyboard.press('ArrowRight');
    await expectSelected('Listen');
    await page.keyboard.press('ArrowLeft');
    await expectSelected('Details');
    await page.keyboard.press('Home');
    await expectSelected('Listen');
  }
});

test('MP-0288-03 Hear it leads Good and Bad, and only previews', async ({ page, request }) => {
  await resetMix(request, [1, 2]);
  await allRendered(request);
  await openEditor(page, 1440);
  const row = page.locator('.timeline .seam').first();
  const hear = row.getByRole('button', { name: 'Hear it', exact: true });
  const good = row.getByRole('button', { name: 'Good', exact: true });
  const bad = row.getByRole('button', { name: 'Bad', exact: true });
  await expect(hear).toBeVisible();
  await expect(hear.locator('svg[data-icon="play"]')).toHaveCount(1);
  const [h, g, b] = [await box(hear), await box(good), await box(bad)];
  expect(h.right, 'Hear it is not first in reading order').toBeLessThanOrEqual(g.left);
  expect(Math.abs(h.top - g.top), 'Hear it is not on the same line as Good').toBeLessThanOrEqual(1);
  expect(Math.abs(h.height - b.height)).toBeLessThanOrEqual(1);
  expect(h.height).toBeGreaterThanOrEqual(44);
  const weight = (locator: Locator) => locator.evaluate((element) => Number(getComputedStyle(element).fontWeight));
  expect(await weight(hear), 'Hear it is no stronger than the verdicts').toBeGreaterThan(await weight(good));
  const before = await (await request.get('/api/mix')).json();
  await hear.click();
  const inspector = page.locator('.inspector').first();
  await expect(inspector.getByRole('tab', { name: 'Listen' })).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.locator('audio.preview')).toHaveAttribute('src', /\/api\/seams\/.+\/preview/);
  // in the inspector the clip sits above its verdict, so hearing comes before judging
  const clip = await box(inspector.locator('audio.preview'));
  const verdict = await box(inspector.locator('.thumbs'));
  expect(clip.bottom).toBeLessThanOrEqual(verdict.top);
  await expect(inspector.locator('.thumbs').getByRole('button', { name: 'Good' })).toHaveAttribute('aria-pressed', 'false');
  // previewing changed nothing: same settings, same rating, same render
  const after = await (await request.get('/api/mix')).json();
  expect(after.mix[1].seam).toEqual(before.mix[1].seam);
});

test('MP-0288-04 You chose, In progress, Made so far and You would hear share one column line', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3]);
  for (const width of [320, 768, 1440]) {
    await openEditor(page, width);
    const inspector = await openInspector(page);
    // the four layers are what Listen shows; Change opens on the choices themselves
    await inspector.getByRole('tab', { name: 'Listen', exact: true }).click();
    const layers = inspector.locator('.seam-layers > div');
    await expect(layers.locator('dt')).toHaveText(['You chose', 'In progress', 'Made so far', 'You’d hear']);
    const rows = await layers.evaluateAll((elements) => elements.map((element) => {
      const dt = element.querySelector('dt')!.getBoundingClientRect();
      const dd = element.querySelector('dd')!.getBoundingClientRect();
      return { dtLeft: dt.left, ddLeft: dd.left, dtTop: dt.top, ddTop: dd.top, ddRight: dd.right, right: element.getBoundingClientRect().right };
    }));
    for (const row of rows) {
      expect(Math.abs(row.dtLeft - rows[0].dtLeft), `${width}px: labels not on one line`).toBeLessThanOrEqual(1);
      expect(Math.abs(row.ddLeft - rows[0].ddLeft), `${width}px: values not on one line`).toBeLessThanOrEqual(1);
      expect(Math.abs(row.dtTop - row.ddTop), `${width}px: a label and its value are not level`).toBeLessThanOrEqual(2);
      expect(row.ddRight).toBeLessThanOrEqual(row.right + 1);
    }
    expect(rows[0].ddLeft - rows[0].dtLeft, `${width}px: the label column is too narrow`).toBeGreaterThanOrEqual(84);
  }
});

test('MP-0288-05 move, bars, cues, help and errors keep one rhythm', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3]);
  for (const width of [320, 1440]) {
    await openEditor(page, width);
    const inspector = await openInspector(page);
    await inspector.getByRole('tab', { name: 'Change' }).click();
    await expect(inspector.locator('.editor fieldset').first()).toBeVisible();
    // a blend uses bars and exact cues, so every field group is on screen at once
    const blend = inspector.locator('.chips.moves button:not([disabled])').filter({ hasText: /blend/i }).first();
    if (await blend.count()) await blend.click();
    await settle(page);
    const reading = await inspector.locator('.editor').evaluate((editor) => {
      const sets = [...editor.querySelectorAll(':scope > fieldset')];
      const rect = (element: Element) => element.getBoundingClientRect();
      const legendGaps = sets.map((set) => {
        const legend = set.querySelector('legend');
        const next = legend?.nextElementSibling;
        return legend && next ? Math.round(rect(next).top - rect(legend).bottom) : null;
      }).filter((gap): gap is number => gap !== null);
      const between = sets.slice(1).map((set, index) => Math.round(rect(set).top - rect(sets[index]).bottom));
      const chipGaps = [...editor.querySelectorAll('.chips')].map((chips) => getComputedStyle(chips).columnGap);
      const cues = [...editor.querySelectorAll('.cue-row label')].map((label) => {
        const [words, select, hint] = [label.querySelector('span'), label.querySelector('select'), label.querySelector('small')];
        return words && select && hint ? [Math.round(rect(select).top - rect(words).bottom), Math.round(rect(hint).top - rect(select).bottom)] : null;
      }).filter(Boolean);
      return { sets: sets.length, legendGaps, between, chipGaps, cues };
    });
    expect(reading.sets).toBeGreaterThanOrEqual(1);
    for (const gap of reading.legendGaps) expect(Math.abs(gap - reading.legendGaps[0]), `${width}px: legend gaps differ`).toBeLessThanOrEqual(1);
    for (const gap of reading.between) expect(Math.abs(gap - reading.between[0]), `${width}px: gaps between groups differ`).toBeLessThanOrEqual(1);
    expect(new Set(reading.chipGaps).size, `${width}px: chip gaps differ`).toBe(1);
    for (const cue of reading.cues) {
      for (const gap of cue!) expect(gap, `${width}px: cue label, select and hint overlap or drift`).toBeGreaterThanOrEqual(0);
      for (const gap of cue!) expect(gap).toBeLessThanOrEqual(12);
    }
  }
});

test('MP-0288-05 a refused change shows its error under the fields, tied to them', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3]);
  await page.route('**/api/mix/1/seam', (route) => route.fulfill({ status: 400, json: { detail: 'That move cannot be saved for this pair.' } }));
  await openEditor(page, 1440);
  const inspector = await openInspector(page);
  await inspector.getByRole('tab', { name: 'Change' }).click();
  await inspector.locator('.chips.moves button:not([disabled]):not([aria-pressed="true"])').first().click();
  const error = inspector.locator('.editor > .warn[role="alert"]');
  await expect(error).toContainText('That move cannot be saved');
  const last = await box(inspector.locator('.editor > fieldset').last());
  const shown = await box(error);
  expect(shown.top - last.bottom, 'the error is not next to the fields it is about').toBeGreaterThanOrEqual(0);
  expect(shown.top - last.bottom).toBeLessThanOrEqual(24);
});

test('MP-0288-06 the 320px sheet and the resized rail never cover the call to action or the focus', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3]);
  // phone: a sheet; its close, tabs and Render or Studio actions stay clickable above the bars
  await openEditor(page, 320, 640);
  let inspector = await openInspector(page);
  const sheet = page.locator('.overlay-sheet');
  await expect(sheet).toBeVisible();
  const checkReachable = async (where: string) => {
    for (const name of ['Listen', 'Change', 'Studio', 'Details']) {
      const tab = inspector.getByRole('tab', { name, exact: true });
      await tab.scrollIntoViewIfNeeded();
      expect(await unobscured(tab), `${where}: ${name} tab is covered`).toBe(true);
    }
    const cta = inspector.locator('.primary').first();
    if (await cta.count()) {
      await cta.scrollIntoViewIfNeeded();
      expect(await unobscured(cta), `${where}: the call to action is covered`).toBe(true);
    }
    // walking the focus through the panel, every stop is on screen and on top
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return null;
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { inside: rect.top >= 0 && rect.bottom <= window.innerHeight + 1, top: !!hit && (hit === element || element.contains(hit) || hit.contains(element)), name: element.textContent?.slice(0, 30) };
      });
      if (!focused) continue;
      expect(focused.inside, `${where}: focus on "${focused.name}" is off screen`).toBe(true);
      expect(focused.top, `${where}: focus on "${focused.name}" is covered`).toBe(true);
    }
  };
  await inspector.getByRole('tab', { name: 'Listen' }).focus();
  await checkReachable('320px sheet');

  // desktop: the rail at its narrowest and widest
  await openEditor(page, 1440, 900);
  inspector = await openInspector(page);
  const handle = page.getByRole('separator', { name: 'Resize inspector' });
  for (const key of ['Home', 'End']) {
    await handle.focus();
    await page.keyboard.press(key);
    await settle(page);
    const rail = page.locator('.edit-inspector');
    expect(await rail.evaluate((element) => element.scrollWidth - element.clientWidth), `${key}: rail scrolls sideways`).toBeLessThanOrEqual(1);
    expect(await unobscured(page.locator('.edit-inspector .inspector-head button[aria-label="Close"]')), `${key}: Close covered`).toBe(true);
    await inspector.getByRole('tab', { name: 'Listen' }).focus();
    await checkReachable(`rail after ${key}`);
  }
});

test('MP-0288-07 a reorder or a late answer never switches the pair being inspected', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3, 4]);
  const { mix } = await (await request.get('/api/mix')).json();
  const [one, two, three] = mix.map((item: { title: string }) => item.title);
  await openEditor(page, 1440);
  // open the second transition, two into three
  await page.locator('.timeline .seam').nth(1).getByRole('button', { name: 'Change', exact: true }).click();
  const pair = page.locator('.inspector-pair b');
  await expect(pair).toHaveText([two, three]);

  // a slow capability check for this pair arrives after another pair was picked: it must not win
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/mix/2/options*', async (route) => { await held; await route.continue(); });
  const four = mix[3].title;
  await page.locator('.timeline .seam').nth(2).getByRole('button', { name: 'Change', exact: true }).click();
  await expect(page.locator('.inspector-number')).toHaveText('Transition 3');
  await expect(pair).toHaveText([three, four]);
  await page.locator('.timeline .seam').nth(1).getByRole('button', { name: 'Change', exact: true }).click();
  await expect(pair).toHaveText([two, three]);
  await page.locator('.timeline .seam').nth(2).getByRole('button', { name: 'Change', exact: true }).click();
  await expect(pair).toHaveText([three, four]);
  release();
  await page.waitForTimeout(800);
  await expect(pair).toHaveText([three, four]);
  await expect(page.locator('.inspector-number')).toHaveText('Transition 3');
  await page.unroute('**/api/mix/2/options*');

  // song one moves down, past two: three into four is untouched, so it stays the one inspected
  await page.getByRole('button', { name: `Move ${one} down`, exact: true }).click();
  await expect(page.locator('.timeline .song .song-name b, .timeline [data-song-key] b').first()).toHaveText(two);
  await expect(pair).toHaveText([three, four]);
  // and down again, between three and four: the pair is gone, so the inspector closes and says nothing changed
  await page.getByRole('button', { name: `Move ${one} down`, exact: true }).click();
  await expect(page.getByText(`The transition from ${three} into ${four} isn’t in this mix any more, so nothing was changed.`).first()).toBeAttached({ timeout: 30_000 });
  await expect(page.locator('.inspector-identity')).toHaveCount(0);
});
