import { expect, test, type Page } from '@playwright/test';
import { allRendered, audioClock, resetMix, shownTime, soundsRestarted, spyOnAudio } from './helpers';

/**
 * ADR-0284 Listen: song identity, transport, song strip, lyrics, the coming transition, steering, the
 * fifteen visualisers and audio continuity. Measured in Edge from the real stylesheet against the
 * synthetic library in tests/e2e_server.py (muted). Candidates for an independent reviewer.
 */
const WIDTHS = [320, 768, 1440] as const;
const playButton = (page: Page) => page.locator('.now .transport .primary');

async function listen(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/listen');
  await expect(page.locator('.listen-identity h1')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

async function play(page: Page) {
  await playButton(page).click();
  await expect(playButton(page)).toHaveText('Pause', { timeout: 30_000 });
}

async function djControls(page: Page) {
  const dj = page.locator('details.view-options');
  if (!await dj.evaluate((element) => (element as HTMLDetailsElement).open)) await dj.locator(':scope > summary').click();
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await spyOnAudio(page);
  await resetMix(request);
});

test('MP-0284-01 eyebrow, motif and title, artist and time read in that order and size', async ({ page }) => {
  for (const width of WIDTHS) {
    await listen(page, width);
    const read = await page.evaluate(() => {
      const at = (selector: string) => {
        const element = document.querySelector(selector)!;
        const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, bottom: box.bottom, size: parseFloat(getComputedStyle(element).fontSize), weight: Number(getComputedStyle(element).fontWeight), height: box.height };
      };
      return { eyebrow: at('.listen-identity .eyebrow'), title: at('.listen-identity h1'), motif: at('.listen-identity h1 svg'), artist: at('.listen-identity .artist'), time: at('.strip .time') };
    });
    const where = `${width}px`;
    expect(read.eyebrow.bottom, `${where}: eyebrow above title`).toBeLessThanOrEqual(read.title.top + 1);
    expect(read.artist.top, `${where}: artist under title`).toBeGreaterThanOrEqual(read.title.bottom - 1);
    expect(read.title.size, `${where}: title leads`).toBeGreaterThan(read.artist.size * 1.4);
    expect(read.artist.size, `${where}: artist over the eyebrow`).toBeGreaterThanOrEqual(read.eyebrow.size);
    expect(read.time.size, `${where}: the clock is a detail`).toBeLessThanOrEqual(read.artist.size);
    expect(Math.abs(read.eyebrow.left - read.title.left), `${where}: eyebrow edge`).toBeLessThanOrEqual(1);
    expect(Math.abs(read.artist.left - read.title.left), `${where}: artist edge`).toBeLessThanOrEqual(1);
    // the motif opens the title's first line, inside it
    expect(Math.abs(read.motif.left - read.title.left), `${where}: motif starts the title`).toBeLessThanOrEqual(2);
    expect(read.motif.top, `${where}: motif in the first line`).toBeGreaterThanOrEqual(read.title.top - 1);
    expect(read.motif.height, `${where}: motif no taller than a line`).toBeLessThanOrEqual(read.title.size * 1.5);
  }
});

test('MP-0284-02 Previous, Play/Pause and Next share a centre line, stay put through Play, Pause and Resume, and Volume and Seek work', async ({ page }) => {
  for (const width of WIDTHS) {
    await listen(page, width);
    const read = () => page.locator('.now .transport').evaluate((row) => [...row.querySelectorAll('button')].map((button) => {
      const box = button.getBoundingClientRect();
      return { centre: box.top + box.height / 2, width: box.width, height: box.height, left: box.left };
    }));
    const idle = await read();
    expect(idle.length).toBe(3);
    for (const button of idle) {
      expect(Math.abs(button.centre - idle[1].centre), `${width}px: off the centre line`).toBeLessThanOrEqual(1);
      expect(button.height, `${width}px: target`).toBeGreaterThanOrEqual(44);
      expect(button.width, `${width}px: target`).toBeGreaterThanOrEqual(44);
    }
    expect(idle[1].width, `${width}px: Play leads`).toBeGreaterThan(idle[0].width);
    await play(page);
    const playing = await read();
    await playButton(page).click();
    await expect(playButton(page)).toHaveText('Resume');
    const paused = await read();
    for (const state of [playing, paused]) expect(Math.abs(state[2].left - playing[2].left), `${width}px: Next moved with the label`).toBeLessThanOrEqual(1);
  }
  // Volume: keyboard on the slider changes the level; Seek: the strip moves the clock
  const volume = page.locator('.now .transport-more').getByRole('slider', { name: 'Volume' });
  await expect(volume).toBeVisible();
  const before = await volume.inputValue();
  await volume.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => volume.inputValue()).not.toBe(before);
  await play(page);
  const strip = page.getByRole('slider', { name: 'Where in the song' });
  await strip.focus();
  const was = await shownTime(page);
  await page.keyboard.press('End');
  await expect.poll(() => shownTime(page)).toBeGreaterThan(was + 5);
});

test('MP-0284-03 the clock, playhead and seam mark on the strip follow the real audio clock', async ({ page, request }) => {
  await allRendered(request);
  await listen(page);
  await play(page);
  const start = (await audioClock(page))[0];
  await expect.poll(async () => (await audioClock(page))[0]).toBeGreaterThan(start + 2);
  const read = await page.evaluate(() => {
    const strip = document.querySelector('.strip')!.getBoundingClientRect();
    const head = document.querySelector('.strip .playhead')!.getBoundingClientRect();
    const seam = document.querySelector<HTMLElement>('.strip .seam-mark');
    const max = Number(document.querySelector('.strip')!.getAttribute('aria-valuemax'));
    return {
      max,
      headPart: (head.left - strip.left) / strip.width,
      seamPart: seam ? (seam.getBoundingClientRect().left - strip.left) / strip.width : null,
      seamTitle: seam?.title ?? null,
      words: document.querySelector('.strip')!.getAttribute('aria-valuetext'),
      shown: document.querySelector('.strip .time')!.textContent,
    };
  });
  const shown = await shownTime(page);
  expect(shown, 'shown time moves').toBeGreaterThanOrEqual(1);
  // the playhead sits where the shown time says, within a second of song
  expect(Math.abs(read.headPart * read.max - shown), 'playhead vs clock').toBeLessThanOrEqual(1.5);
  expect(read.shown).toContain(read.words!.split(' of ')[0]);
  if (read.seamPart !== null) {
    const match = /(\d+):(\d+)/.exec(read.seamTitle!)!;
    const seamAt = Number(match[1]) * 60 + Number(match[2]);
    expect(Math.abs(read.seamPart * read.max - seamAt), 'seam mark at its time').toBeLessThanOrEqual(1.5);
  }
  // and the clock keeps counting with the audio
  const later = await shownTime(page);
  await expect.poll(() => shownTime(page)).toBeGreaterThan(later);
});

test('MP-0284-04 the current lyric leads, neighbours stay readable, and untimed and instrumental songs say so', async ({ page }) => {
  await listen(page);
  await play(page);
  await expect(page.locator('.lyrics .sung')).toBeVisible({ timeout: 20_000 });
  const read = await page.evaluate(() => {
    const sung = document.querySelector('.lyrics .sung')!;
    const dim = document.querySelector('.lyrics .dim')!;
    const style = (element: Element) => getComputedStyle(element);
    return { sung: parseFloat(style(sung).fontSize), dim: parseFloat(style(dim).fontSize), dimOpacity: Number(style(dim).opacity), dimColour: style(dim).color, sungColour: style(sung).color };
  });
  expect(read.sung, 'current line leads').toBeGreaterThanOrEqual(read.dim);
  expect(read.dim, 'neighbours readable').toBeGreaterThanOrEqual(14);
  expect(read.dimOpacity, 'neighbours not faded away').toBeGreaterThanOrEqual(0.45);
  expect(read.sungColour).not.toBe(read.dimColour);
  // the fallbacks, with the real song detail changed in flight
  for (const [status, words] of [['plain', /aren’t timed/], ['instrumental', /Instrumental/], ['failed', /didn’t work/]] as const) {
    await page.route('**/api/songs/*', async (route) => {
      if (route.request().method() !== 'GET' || /\/audio|\/peaks/.test(route.request().url())) return route.fallback();
      const answer = await route.fetch();
      await route.fulfill({ response: answer, json: { ...await answer.json(), lines: [], lyric_status: status } });
    });
    await listen(page);
    const fallback = page.locator('.lyrics.quiet p');
    await expect(fallback).toHaveText(words);
    expect(await fallback.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
    await page.unroute('**/api/songs/*');
  }
});

test('MP-0284-05 the countdown, the next title and whether its transition is made read as one column', async ({ page, request }) => {
  await allRendered(request);
  for (const width of [768, 1440]) {
    await listen(page, width);
    await play(page);
    await expect(page.locator('.listen-side .handoff')).toBeVisible();
    const read = await page.evaluate(() => {
      const at = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      return { handoff: at('.listen-side .handoff'), next: at('.listen-side .next-up'), truth: at('.listen-side .transition-truth'), nextName: document.querySelector('.listen-side .handoff-next b, .listen-side .handoff b')?.textContent, upNext: document.querySelector('.next-up .next-song b')?.textContent };
    });
    const where = `${width}px`;
    expect(read.next!.top, `${where}: next after the countdown`).toBeGreaterThanOrEqual(read.handoff!.bottom - 1);
    expect(read.next!.top - read.handoff!.bottom, `${where}: kept together`).toBeLessThanOrEqual(48);
    expect(Math.abs(read.next!.left - read.handoff!.left), `${where}: one column`).toBeLessThanOrEqual(1);
    expect(read.truth, `${where}: says whether it is made`).not.toBeNull();
    expect(read.truth!.top).toBeGreaterThanOrEqual(read.next!.top);
    expect(read.nextName, `${where}: the countdown names the same song`).toBe(read.upNext);
    await playButton(page).click();
  }
});

test('MP-0284-06 Bigger, Calmer, Something else, Good and Bad are one disclosure away and never primary', async ({ page }) => {
  await listen(page);
  await play(page);
  const summary = page.locator('details.view-options > summary');
  await expect(summary).toBeVisible();
  await expect(summary).toHaveText('DJ controls');
  await djControls(page);
  const steer = page.getByRole('group', { name: 'Change what plays next' });
  for (const name of ['Bigger', 'Calmer', 'Something else']) await expect(steer.getByRole('button', { name })).toBeVisible();
  const look = await page.evaluate(() => {
    const primary = document.querySelector('.now .transport .primary')!;
    const styleOf = (element: Element) => ({ background: getComputedStyle(element).backgroundColor, size: parseFloat(getComputedStyle(element).fontSize), height: element.getBoundingClientRect().height });
    return { primary: styleOf(primary), steer: [...document.querySelectorAll('.steer button, .thumbs button')].map((button) => ({ ...styleOf(button), primary: button.classList.contains('primary') })) };
  });
  for (const button of look.steer) {
    expect(button.primary, 'a steering control is primary').toBe(false);
    expect(button.background, 'a steering control is filled like Play').not.toBe(look.primary.background);
    expect(button.height, 'still a full target').toBeGreaterThanOrEqual(36);
    expect(button.height).toBeLessThanOrEqual(look.primary.height);
  }
  // Good and Bad appear for a transition that has just played; the source puts them in the same disclosure
  expect(await page.locator('details.view-options .thumbs, details.view-options .listen-next-steering').count()).toBeGreaterThan(0);
});

test('MP-0284-07 all fifteen visualisers draw only from the live analyser, in one frame, and stay still when asked', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await listen(page);
  await play(page);
  await djControls(page);
  const choose = page.getByRole('combobox', { name: 'Audio visualizer style' });
  const values = await choose.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(values.length, 'fifteen modes').toBe(15);
  const started = await soundsRestarted(page);
  const ink = () => page.locator('canvas.music-visualizer').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const data = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    let painted = 0;
    for (let index = 3; index < data.length; index += 16) if (data[index] > 0) painted += 1;
    const box = element.getBoundingClientRect();
    return { painted, width: box.width, height: box.height, label: element.getAttribute('aria-label') };
  });
  let frame: { width: number; height: number } | null = null;
  for (const value of values) {
    await choose.selectOption(value);
    await expect.poll(async () => (await ink()).painted, { message: `${value} draws from the analyser` }).toBeGreaterThan(0);
    const read = await ink();
    expect(read.label, value).toMatch(/actual mixed-audio frequency levels/);
    frame ??= read;
    expect(Math.abs(read.width - frame.width), `${value}: same frame width`).toBeLessThanOrEqual(1);
    expect(Math.abs(read.height - frame.height), `${value}: same frame height`).toBeLessThanOrEqual(1);
  }
  expect(await soundsRestarted(page), 'changing visualiser restarts nothing').toBe(started);
  // paused, there is no signal: the canvas is cleared rather than drawn from anything made up
  await playButton(page).click();
  await expect(playButton(page)).toHaveText('Resume');
  await expect.poll(async () => (await ink()).painted).toBe(0);
  await expect(page.locator('canvas.music-visualizer')).toHaveAttribute('aria-label', 'Audio frequency visualizer paused');
  // reduced motion: one still frame from real data, no running loop
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await play(page);
  const counted = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas.music-visualizer') as HTMLCanvasElement;
    const sample = () => canvas.toDataURL();
    const first = sample();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return first === sample();
  });
  expect(counted, 'still under reduced motion').toBe(true);
  // both themes repaint from the page's own colours
  for (const theme of ['Dark', 'Light']) {
    await page.locator('.theme-menu > button').click();
    await page.getByRole('menuitemradio', { name: theme }).click();
    await expect(playButton(page)).toHaveText('Pause');
  }
  expect(await soundsRestarted(page), 'theme changes restart nothing').toBe(started);
});

test('MP-0284-08 moving around and changing what is shown never restarts the music or undoes Pause', async ({ page }) => {
  await listen(page);
  await play(page);
  const started = await soundsRestarted(page);
  await djControls(page);
  await page.getByRole('button', { name: 'Lyrics focus' }).click();
  await page.getByRole('button', { name: 'Lyrics focus' }).click();
  await page.getByRole('button', { name: 'Focused visuals' }).click();
  await page.getByRole('button', { name: 'Standard visuals' }).click();
  for (const route of ['/library', '/mixes', '/mix/current/edit', '/listen']) {
    await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
    await expect(page.locator('main#main')).toBeVisible();
  }
  await expect(playButton(page)).toHaveText('Pause');
  expect(await soundsRestarted(page), 'nothing restarted').toBe(started);
  const clock = (await audioClock(page))[0];
  await expect.poll(async () => (await audioClock(page))[0]).toBeGreaterThan(clock + 0.3);
  // Pause holds through the same journey
  await playButton(page).click();
  await expect(playButton(page)).toHaveText('Resume');
  const paused = await shownTime(page);
  await djControls(page);
  await page.getByRole('button', { name: 'Spectrum' }).click();
  for (const route of ['/library', '/listen']) {
    await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
    await expect(page.locator('main#main')).toBeVisible();
  }
  await page.waitForTimeout(1500);
  await expect(playButton(page)).toHaveText('Resume');
  expect(await shownTime(page), 'still where it paused').toBe(paused);
  expect(await soundsRestarted(page), 'nothing started while paused').toBe(started);
});
