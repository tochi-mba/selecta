import { expect, test, type Page } from '@playwright/test';
import { allRendered, resetMix, spyOnAudio } from './helpers';

/**
 * ADR-0296 motion tokens, interruptions and truthful musical animation, measured in Edge with real
 * (muted) playback of the synthetic library in tests/e2e_server.py. Token and inventory checks are in
 * web/src/styles/motion-tokens.test.ts. Candidates for an independent reviewer.
 */

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

async function play(page: Page) {
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
}

/** Counts every redraw of the Listen visualizer canvas, without changing what it draws. */
async function countDraws(page: Page) {
  await page.addInitScript(() => {
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    (window as unknown as { draws: number }).draws = 0;
    CanvasRenderingContext2D.prototype.clearRect = function counted(...args: Parameters<typeof clear>) {
      if ((this.canvas as HTMLCanvasElement).classList?.contains('music-visualizer')) (window as unknown as { draws: number }).draws += 1;
      return clear.apply(this, args);
    };
  });
}
const draws = (page: Page) => page.evaluate(() => (window as unknown as { draws: number }).draws);

async function strip(page: Page) {
  return page.evaluate(() => {
    const slider = document.querySelector('.strip[role="slider"]')!;
    const head = document.querySelector('.strip .playhead, .playhead') as HTMLElement;
    const box = slider.getBoundingClientRect();
    return {
      now: Number(slider.getAttribute('aria-valuenow')), max: Number(slider.getAttribute('aria-valuemax')),
      head: (head.getBoundingClientRect().left + head.getBoundingClientRect().width / 2 - box.left) / box.width,
      word: document.querySelector('.lyrics .current-word')?.textContent ?? null,
      countdown: document.querySelector('.countdown')?.getAttribute('aria-label') ?? null,
    };
  });
}

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

test('MP-0296-03 hovered and pressed controls never move out from under the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let measured = 0;
  for (const route of ['/mixes', '/library', '/mix/current/edit', '/workshop']) {
    await page.goto(route);
    await expect(page.locator('main#main')).toBeVisible();
    await settle(page);
    const count = Math.min(await page.locator('main button:visible').count(), 14);
    for (let index = 0; index < count; index += 1) {
      const button = page.locator('main button:visible').nth(index);
      if (!(await button.isEnabled())) continue;
      const before = await button.boundingBox();
      if (!before || before.y < 0 || before.y + before.height > 900) continue;
      const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
      await page.mouse.move(centre.x, centre.y);
      await page.waitForTimeout(300);
      const hovered = await button.boundingBox();
      await page.mouse.down();
      await page.waitForTimeout(150);
      const pressed = await button.boundingBox();
      const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.outerHTML.slice(0, 60) ?? null, centre);
      // let go somewhere inert, so nothing is actually pressed
      await page.mouse.move(2, 899);
      await page.mouse.up();
      const name = `${route} button ${index}`;
      for (const [state, box] of [['hovered', hovered], ['pressed', pressed]] as const) {
        expect(Math.abs(box!.x - before.x), `${name} ${state} moved sideways`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(box!.y - before.y), `${name} ${state} moved down`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(box!.width - before.width), `${name} ${state} changed width`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(box!.height - before.height), `${name} ${state} changed height`).toBeLessThanOrEqual(0.5);
      }
      expect(under, `${name}: the pointer left the control`).not.toBeNull();
      measured += 1;
      await page.keyboard.press('Escape');
    }
  }
  expect(measured).toBeGreaterThan(20);
});

test('MP-0296-04 countdown, lyric focus and playhead follow the real player clock', async ({ page, request }) => {
  await spyOnAudio(page);
  await allRendered(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/listen');
  const options = page.locator('details.view-options');
  if (await options.count() && !(await options.evaluate((node) => (node as HTMLDetailsElement).open))) await options.locator('summary').click();
  const countdown = page.getByRole('button', { name: 'Beat countdown' });
  if (await countdown.getAttribute('aria-pressed') === 'false') await countdown.click();
  await play(page);
  // jump near the hand-off, so the countdown is counting
  await page.getByRole('button', { name: 'Jump to the transition' }).click().catch(() => {});
  await page.waitForTimeout(400);
  const samples = [];
  for (let index = 0; index < 6; index += 1) {
    samples.push(await strip(page));
    await page.waitForTimeout(400);
  }
  for (const sample of samples) {
    // the playhead sits where the player's own time puts it (aria-valuenow is that time, rounded)
    expect(Math.abs(sample.head - sample.now / sample.max), `playhead at ${sample.head} for ${sample.now}/${sample.max}`).toBeLessThanOrEqual(1.5 / sample.max + 0.01);
  }
  expect(samples[samples.length - 1].now, 'the clock moves while playing').toBeGreaterThan(samples[0].now);
  // paused: nothing that follows the music moves on its own
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(300);
  const paused = await strip(page);
  await page.waitForTimeout(1500);
  const later = await strip(page);
  expect(later.now).toBe(paused.now);
  expect(Math.abs(later.head - paused.head)).toBeLessThanOrEqual(0.001);
  expect(later.word).toBe(paused.word);
  expect(later.countdown).toBe(paused.countdown);
  const counted = samples.filter((sample) => sample.countdown);
  expect(counted.length, 'countdown shown while counting').toBeGreaterThan(0);
});

test('MP-0296-04 lyric focus moves only with the song', async ({ page, request }) => {
  await allRendered(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/listen');
  await play(page);
  await expect(page.locator('.lyrics .current-word')).toHaveCount(1, { timeout: 30_000 });
  const words = new Set<string>();
  for (let index = 0; index < 10; index += 1) {
    words.add((await strip(page)).word ?? '');
    await page.waitForTimeout(400);
  }
  expect(words.size, 'the focused word follows the song').toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(300);
  const held = (await strip(page)).word;
  await page.waitForTimeout(1500);
  expect((await strip(page)).word).toBe(held);
});

test('MP-0296-05 rapid close, seek and route changes leave no stale animation behind', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workshop');
  await page.evaluate(() => localStorage.setItem('selecta.prefs', JSON.stringify({ motion: 'expressive' })));
  await page.goto('/mixes');
  const customize = page.getByRole('button', { name: 'Customize' });
  for (let index = 0; index < 6; index += 1) {
    await customize.click();
    await page.keyboard.press('Escape');
  }
  for (const link of ['Library', 'Workspace', 'Mixes', 'Library', 'Mixes']) {
    await page.getByRole('link', { name: link, exact: true }).first().click();
  }
  await page.goto('/listen');
  await play(page);
  const slider = page.getByRole('slider', { name: 'Where in the song' });
  await slider.focus();
  for (let index = 0; index < 6; index += 1) await page.keyboard.press(index % 2 ? 'ArrowLeft' : 'ArrowRight');
  await page.getByRole('link', { name: 'Mixes', exact: true }).first().click();
  await page.waitForTimeout(800);
  const left = await page.evaluate(() => ({
    overlays: document.querySelectorAll('.overlay').length,
    // finite animations still running long after they should have finished, or on detached nodes
    stale: document.getAnimations().filter((animation) => {
      const effect = animation.effect as KeyframeEffect | null;
      const timing = effect?.getComputedTiming();
      const target = effect?.target as Element | null;
      if (animation.playState !== 'running') return false;
      if (timing && timing.iterations === Infinity) return false;
      return !target?.isConnected || Number(timing?.endTime ?? 0) < 1000;
    }).map((animation) => (animation as CSSAnimation).animationName ?? 'transition'),
    opacity: getComputedStyle(document.querySelector('main#main')!).opacity,
  }));
  expect(left.overlays, 'a closed overlay is still in the page').toBe(0);
  expect(left.stale).toEqual([]);
  expect(left.opacity).toBe('1');
});

test('MP-0296-06 Still and reduced motion remove decorative movement while the music data keeps updating', async ({ page }) => {
  await countDraws(page);
  for (const mode of ['still', 'os-reduce'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: mode === 'os-reduce' ? 'reduce' : 'no-preference' });
    await page.goto('/workshop');
    await page.evaluate((motion) => localStorage.setItem('selecta.prefs', JSON.stringify({ motion })), mode === 'still' ? 'still' : 'expressive');
    await page.goto('/listen');
    await play(page);
    await page.keyboard.press('f');
    await expect(page.locator('.now.stage')).toBeVisible();
    await page.waitForTimeout(500);
    const start = await page.evaluate(() => ({ draws: (window as unknown as { draws: number }).draws, now: Number(document.querySelector('[role="slider"][aria-valuenow]')?.getAttribute('aria-valuenow') ?? 'NaN') }));
    await page.waitForTimeout(2000);
    const reading = await page.evaluate(() => ({
      draws: (window as unknown as { draws: number }).draws,
      running: document.getAnimations().filter((animation) => animation.playState === 'running').map((animation) => (animation as CSSAnimation).animationName ?? 'transition'),
      transitions: [...document.querySelectorAll('main *')].filter((node) => { const style = getComputedStyle(node); return style.transitionDuration.split(',').some((part) => parseFloat(part) > 0); }).length,
      clock: document.querySelector('.now.stage')?.textContent ?? '',
    }));
    expect(reading.running, `${mode}: decorative animations`).toEqual([]);
    expect(reading.transitions, `${mode}: transitions left on`).toBe(0);
    expect(reading.draws - start.draws, `${mode}: the visualizer keeps animating`).toBeLessThanOrEqual(1);
    // still the music clock: Pause and leave stage, the clock has moved on from where it was
    await page.keyboard.press('f');
    const now = Number(await page.getByRole('slider', { name: 'Where in the song' }).getAttribute('aria-valuenow'));
    expect(now, `${mode}: the clock stopped`).toBeGreaterThan(Number.isNaN(start.now) ? 0 : start.now);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
  }
});

test('MP-0296-07 the visualizer draws at most 15 frames a second while playing and nothing while hidden', async ({ page }) => {
  await countDraws(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/listen');
  await play(page);
  await page.keyboard.press('f');
  await expect(page.locator('canvas.music-visualizer')).toBeVisible();
  await page.waitForTimeout(500);
  const before = await draws(page);
  const started = Date.now();
  await page.waitForTimeout(3000);
  const drawn = await draws(page) - before;
  const seconds = (Date.now() - started) / 1000;
  expect(drawn / seconds, 'frames a second while playing').toBeLessThanOrEqual(15.5);
  expect(drawn, 'it does draw while playing').toBeGreaterThan(seconds * 5);
  // the tab goes to the background
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  const hidden = await draws(page);
  await page.waitForTimeout(2000);
  expect(await draws(page) - hidden, 'draws while hidden').toBe(0);
  // and back
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1000);
  expect(await draws(page) - hidden, 'draws again once visible').toBeGreaterThan(3);
});
