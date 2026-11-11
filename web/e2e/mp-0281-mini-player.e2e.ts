import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { audioClock, resetMix, soundsRestarted, spyOnAudio } from './helpers';

/**
 * ADR-281 persistent mini-player and fixed chrome, measured from the real stylesheet in Edge against the
 * synthetic library in tests/e2e_server.py, with real (muted) playback. Candidates for an independent
 * reviewer, not a human visual or listening approval.
 */
const WIDTHS = [320, 375, 768, 1440] as const;
type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

const transport = (page: Page) => page.locator('.now .transport .primary');
const mini = (page: Page) => page.locator('.mini');

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

/** Playing from Listen, then over to the Library by the rail, so the music never reloads. */
async function playingOnLibrary(page: Page) {
  await page.goto('/listen');
  await expect(page.locator('.lyrics')).toBeVisible();
  await transport(page).click();
  await expect(transport(page)).toHaveText('Pause', { timeout: 30_000 });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(mini(page)).toBeVisible();
}

/** The player's parts, in viewport pixels. */
function parts() {
  const box = (element: Element | null) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const bar = document.querySelector('.mini')!;
  const style = getComputedStyle(bar);
  const glyph = (selector: string) => box(document.querySelector(`${selector} svg, ${selector} .ui-icon`));
  return {
    mini: box(bar)!,
    borderTop: parseFloat(style.borderTopWidth),
    progress: box(document.querySelector('.mini-progress')),
    play: box(document.querySelector('.mini .round')),
    playGlyph: glyph('.mini .round'),
    playFill: getComputedStyle(document.querySelector('.mini .round')!).backgroundColor,
    next: box(document.querySelector('.mini-next')),
    nextGlyph: glyph('.mini-next'),
    nextFill: getComputedStyle(document.querySelector('.mini-next')!).backgroundColor,
    song: box(document.querySelector('.mini-song')),
    title: box(document.querySelector('.mini-song b')),
    artist: box(document.querySelector('.mini-song span')),
    requests: box(document.querySelector('.mini-requests')),
    requestsClipped: (() => { const button = document.querySelector<HTMLElement>('.mini-requests'); return button ? button.scrollWidth > button.clientWidth + 1 : null; })(),
    volume: box(document.querySelector('.mini-volume')),
    nav: box(document.querySelector('nav.nav')),
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}
type Parts = ReturnType<typeof parts>;
const middle = (box: Box) => (box.top + box.bottom) / 2;
const visible = (box: Box | null): box is Box => !!box && box.width > 0 && box.height > 0;

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0281-01 progress, title, artist and transport share the 66px bar’s middle', async ({ page }, info) => {
  await playingOnLibrary(page);
  const readings: Parts[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await settle(page);
    const found = await page.evaluate(parts);
    const where = `${width}px`;
    expect(found.mini.height, `${where}: bar height`).toBeCloseTo(66, 0);
    // the middle of the room under the 1px top edge
    const centre = (found.mini.top + found.borderTop + found.mini.bottom) / 2;
    for (const [name, part] of [['Play', found.play], ['Next', found.next], ['song words', found.song]] as const) {
      expect(visible(part), `${where}: ${name} is shown`).toBe(true);
      expect(Math.abs(middle(part!) - centre), `${where}: ${name} is off the bar’s middle`).toBeLessThanOrEqual(1);
    }
    if (visible(found.requests)) expect(Math.abs(middle(found.requests) - centre), `${where}: Request off the middle`).toBeLessThanOrEqual(1);
    // the progress line sits on the top edge, across the whole bar
    expect(Math.abs(found.progress!.top - found.mini.top), `${where}: progress leaves the top edge`).toBeLessThanOrEqual(1);
    expect(found.progress!.height).toBeLessThanOrEqual(3);
    // title over artist, one block, inside the bar
    expect(found.title!.bottom, `${where}: title overlaps artist`).toBeLessThanOrEqual(found.artist!.top + 1);
    expect(found.title!.top, `${where}: title above the bar`).toBeGreaterThanOrEqual(found.mini.top);
    expect(found.artist!.bottom, `${where}: artist below the bar`).toBeLessThanOrEqual(found.mini.bottom);
    expect(Math.abs(found.title!.left - found.artist!.left), `${where}: title and artist start apart`).toBeLessThanOrEqual(1);
    readings.push(found);
  }
  writeFileSync(info.outputPath('mp-0281-01-mini.json'), JSON.stringify({ status: 'candidate-not-independently-verified', readings }, null, 2));
});

test('MP-0281-02 Play/Pause outweighs Next, and both stay 44px targets', async ({ page }) => {
  await playingOnLibrary(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await settle(page);
    const found = await page.evaluate(parts);
    const where = `${width}px`;
    for (const [name, part] of [['Play', found.play!], ['Next', found.next!]] as const) {
      expect(part.width, `${where}: ${name} width`).toBeGreaterThanOrEqual(44);
      expect(part.height, `${where}: ${name} height`).toBeGreaterThanOrEqual(44);
    }
    // Play is a filled disc; Next is a bare glyph on the bar, and never the bigger glyph
    expect(found.playFill, `${where}: Play has a fill`).not.toBe('rgba(0, 0, 0, 0)');
    expect(found.playFill, `${where}: Play and Next look the same`).not.toBe(found.nextFill);
    expect(found.playGlyph!.width, `${where}: Next glyph bigger than Play`).toBeGreaterThanOrEqual(found.nextGlyph!.width);
    expect(found.play!.left, `${where}: Play comes first`).toBeLessThan(found.next!.left);
  }
});

test('MP-0281-03 time ticking, the next song and a long title never move the controls', async ({ page }) => {
  await playingOnLibrary(page);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await settle(page);
    const before = await page.evaluate(parts);
    const where = `${width}px`;
    const same = (after: Parts, why: string) => {
      for (const name of ['play', 'next', 'requests', 'volume'] as const) {
        const was = before[name];
        const now = after[name];
        if (!visible(was)) continue;
        expect(Math.abs(now!.left - was.left), `${where} ${why}: ${name} moved sideways`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(now!.top - was.top), `${where} ${why}: ${name} moved up or down`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(now!.width - was.width), `${where} ${why}: ${name} changed width`).toBeLessThanOrEqual(0.5);
      }
    };
    // the clock ticks through a second boundary
    const clock = await page.locator('.mini-song span').textContent();
    await expect(page.locator('.mini-song span')).not.toHaveText(clock ?? '', { timeout: 5_000 });
    same(await page.evaluate(parts), 'after the clock ticked');
    // the next song: a different title, artist and duration
    const title = await page.locator('.mini-song b').textContent();
    await page.locator('.mini-next').click();
    await expect(page.locator('.mini-song b')).not.toHaveText(title ?? '', { timeout: 30_000 });
    await expect(page.locator('.mini .round')).toBeEnabled({ timeout: 30_000 });
    same(await page.evaluate(parts), 'after Next');
    // a very long title and artist (as the stress library has); React writes it back on its next tick
    const stretched = await page.evaluate(() => {
      // written into React's own text nodes (not replacing them), so its next tick really does write them back
      const write = (element: Element, text: string) => {
        const nodes = [...element.childNodes].filter((node): node is Text => node.nodeType === Node.TEXT_NODE);
        nodes.forEach((node, index) => { node.data = index === 0 ? text : ''; });
      };
      // long enough to overflow even the 1440px bar's song slot
      write(document.querySelector('.mini-song b')!, 'An extraordinarily long song title that keeps going well past any sensible width (Extended Club Remix) '.repeat(3).trim());
      write(document.querySelector('.mini-song span')!, 'A Very Long Collective Name featuring Several Other Artists · 12:34 / 59:59');
      const song = document.querySelector<HTMLElement>('.mini-song b')!;
      return song.scrollWidth > song.clientWidth;
    });
    expect(stretched, `${where}: the long title is cut with an ellipsis rather than pushing`).toBe(true);
    same(await page.evaluate(parts), 'with a long title');
  }
});

test('MP-0281-04 the Request button and its count stay whole and clear at narrow widths', async ({ page }) => {
  await playingOnLibrary(page);
  for (const width of [320, 360, 375, 420, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await settle(page);
    const found = await page.evaluate(parts);
    const where = `${width}px`;
    expect(visible(found.requests), `${where}: Request shown`).toBe(true);
    expect(found.requests!.right, `${where}: Request runs off the window`).toBeLessThanOrEqual(width + 0.5);
    expect(found.requestsClipped, `${where}: Request words clipped`).toBe(false);
    expect(found.requests!.height, `${where}: Request target`).toBeGreaterThanOrEqual(44);
    expect(found.requests!.left, `${where}: Request overlaps Next`).toBeGreaterThanOrEqual(found.next!.right);
    // the song name still has room to be read beside it
    expect(found.song!.width, `${where}: no room left for the song`).toBeGreaterThanOrEqual(60);
    await expect(page.locator('.mini-requests')).toHaveAccessibleName(/^Requests/);
  }
});

test('MP-0281-05 on a phone the 58px tab bar and the player stack without overlap or double padding', async ({ page }) => {
  await playingOnLibrary(page);
  for (const [width, height] of [[320, 568], [375, 667], [760, 900]] as const) {
    await page.setViewportSize({ width, height });
    await settle(page);
    const found = await page.evaluate(parts);
    const where = `${width}x${height}`;
    expect(found.nav!.height, `${where}: tab bar height`).toBeCloseTo(58, 0);
    expect(Math.abs(found.nav!.bottom - height), `${where}: tab bar off the bottom`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(found.mini.bottom - found.nav!.top), `${where}: gap or overlap between player and tab bar`).toBeLessThanOrEqual(0.5);
    const padding = await page.evaluate(() => {
      const content = document.querySelector('.content')!;
      const main = document.querySelector('main#main')!;
      const space = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-5')) * (getComputedStyle(document.documentElement).getPropertyValue('--space-5').includes('rem') ? 16 : 1);
      return { content: parseFloat(getComputedStyle(content).paddingBottom), main: parseFloat(getComputedStyle(main).paddingBottom) + parseFloat(getComputedStyle(main).marginBottom), space };
    });
    // the frame pads once, for exactly the bars that are there
    expect(padding.content, `${where}: content padding`).toBeCloseTo(58 + 66 + padding.space, 0);
    expect(padding.main, `${where}: the page pads for the bars a second time`).toBeLessThan(58 + 66);
    // and the end of the page scrolls clear of both. Library rows lay out only near the screen
    // (content-visibility, MP-0272), so rows remembered at a wider window grow as they come into
    // view: keep going to the end until the page stops growing, as a person scrolling would.
    await page.evaluate(async () => {
      for (let tries = 0; tries < 20; tries++) {
        const height = document.documentElement.scrollHeight;
        window.scrollTo(0, height);
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        if (document.documentElement.scrollHeight === height && Math.ceil(window.scrollY + window.innerHeight) >= height) return;
      }
    });
    const last = await page.evaluate(() => {
      const items = [...document.querySelectorAll<HTMLElement>('main#main button, main#main a, main#main input')].filter((item) => item.getClientRects().length);
      return items.at(-1)!.getBoundingClientRect().bottom;
    });
    expect(last, `${where}: last control under the player`).toBeLessThanOrEqual(found.mini.top);
  }
});

test('MP-0281-06 a keyboard or an overlay never has the player cover it, and the music keeps going', async ({ page }) => {
  await spyOnAudio(page);
  await playingOnLibrary(page);
  const running = async (why: string) => {
    const [first] = await audioClock(page);
    await page.waitForTimeout(600);
    const [later] = await audioClock(page);
    expect(later - first, `music stopped ${why}`).toBeGreaterThan(0.3);
  };
  await page.setViewportSize({ width: 375, height: 667 });
  // the keyboard: a real phone sets this from the visual viewport
  await page.getByRole('searchbox', { name: 'Search your library' }).focus();
  await page.evaluate(() => { document.documentElement.dataset.keyboard = 'open'; });
  await expect(mini(page)).toBeHidden();
  await running('with the keyboard up');
  await page.evaluate(() => { delete document.documentElement.dataset.keyboard; });
  await expect(mini(page)).toBeVisible();
  await page.locator('main#main').click({ position: { x: 5, y: 5 } });

  // overlays at a phone and a desk width: every control in them can be reached, none sits under the player
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: width < 760 ? 667 : 900 });
    for (const open of [
      async () => page.getByRole('button', { name: /^Activity/ }).first().click(),
      async () => page.locator('.mini-requests').click(),
    ]) {
      await open();
      const panel = page.locator('.overlay-panel').last();
      await expect(panel).toBeVisible();
      await settle(page);
      const covered = await panel.evaluate((root) => [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')]
        .filter((control) => control.getClientRects().length)
        .flatMap((control) => {
          const rect = control.getBoundingClientRect();
          const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
          const y = rect.top + rect.height / 2;
          if (y < 0 || y >= window.innerHeight) return [];
          const top = document.elementFromPoint(x, y);
          return top && top.closest('.mini') ? [control.textContent?.trim() || control.getAttribute('aria-label') || control.tagName] : [];
        }));
      expect(covered, `${width}px: overlay controls under the player`).toEqual([]);
      await running(`with an overlay open at ${width}px`);
      await page.keyboard.press('Escape');
      await expect(page.locator('.overlay-panel')).toHaveCount(0);
    }
  }
});

test('MP-0281-07 Listen and the fullscreen Stage have no second, mini player', async ({ page }) => {
  await page.goto('/listen');
  await expect(page.locator('.lyrics')).toBeVisible();
  await transport(page).click();
  await expect(transport(page)).toHaveText('Pause', { timeout: 30_000 });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(mini(page), `Listen at ${width}px`).toHaveCount(0);
  }
  const launcher = page.locator('[data-stage-launcher]');
  await launcher.evaluate((button) => { for (let up = button.parentElement; up; up = up.parentElement) if (up.tagName === 'DETAILS') (up as HTMLDetailsElement).open = true; });
  await launcher.click();
  await expect(page.locator('.stage-controls')).toBeVisible();
  await expect(mini(page), 'on the Stage').toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--player-height').trim())).toBe('0px');
  await page.locator('.exit-stage').click();
  await expect(page.locator('.stage-controls')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library', exact: true }).click();
  await expect(mini(page)).toHaveCount(1);
});

test('MP-0281-08 changing page or theme keeps one audio owner, and Pause stays paused', async ({ page }) => {
  await spyOnAudio(page);
  await playingOnLibrary(page);
  const contexts = await page.evaluate(() => window.audioSpy.contexts.length);
  const started = await soundsRestarted(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const tour = async () => {
    for (const name of ['Make a Mix', 'My Mixes', 'Library']) {
      const link = nav.getByRole('link', { name, exact: true });
      if (await link.count()) {
        await link.click();
        await expect(mini(page)).toHaveCount(1);
      }
    }
    for (const theme of ['Light', 'Dark', 'Match this computer']) {
      await page.locator('[title^="Theme:"]').first().click();
      await page.getByRole('menuitemradio', { name: theme }).click();
      await expect(mini(page)).toHaveCount(1);
    }
  };
  await tour();
  // no second player was made, and nothing restarted the song
  expect(await page.evaluate(() => window.audioSpy.contexts.length), 'audio contexts after moving around').toBe(contexts);
  expect(await soundsRestarted(page), 'sounds restarted by moving around').toBe(started);
  expect(await page.locator('audio, video').count(), 'a media element appeared').toBe(0);

  // a deliberate Pause holds across pages and themes
  await page.locator('.mini .round').click();
  await expect(page.locator('.mini .round')).toHaveAccessibleName('Resume');
  const [paused] = await audioClock(page);
  const startedPaused = await soundsRestarted(page);
  await tour();
  await expect(page.locator('.mini .round')).toHaveAccessibleName('Resume');
  expect(await soundsRestarted(page), 'a sound started while paused').toBe(startedPaused);
  const states = await page.evaluate(() => window.audioSpy.contexts.map((context) => context.state));
  const [later] = await audioClock(page);
  // paused means the clock is held or the context is suspended
  expect(later - paused < 0.05 || states.every((state) => state !== 'running'), `audio still advancing after Pause (${states})`).toBe(true);
  await page.locator('.mini .round').click();
  await expect(page.locator('.mini .round')).toHaveAccessibleName('Pause');
});
