import { expect, Page, test } from '@playwright/test';
import { allRendered, audioClock, audioStates, resetMix, shownTime, soundsStarted, spyOnAudio } from './helpers';

const title = (page: Page) => page.locator('h1.display');
const pauseButton = (page: Page) => page.getByRole('button', { name: 'Pause', exact: true });
const resumeButton = (page: Page) => page.getByRole('button', { name: 'Resume', exact: true });

async function play(page: Page) {
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(pauseButton(page)).toBeVisible();
}

async function pointAtPart(page: Page, part: number) {
  const strip = page.getByRole('slider', { name: 'Where in the song' });
  const box = (await strip.boundingBox())!;
  await strip.click({ position: { x: box.width * part, y: box.height / 2 } });
}

let problems: string[] = [];

test.beforeEach(async ({ page, request }) => {
  problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) problems.push(message.text());
  });
  await spyOnAudio(page);
  await resetMix(request);
  await allRendered(request);
  await page.goto('/listen');
  await expect(title(page)).toHaveText('Morning Light');
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('Play makes real sound, on a clock that really moves', async ({ page }) => {
  await play(page);
  expect(await audioStates(page)).toEqual(['running']);
  const [before] = await audioClock(page);
  await page.waitForTimeout(2000);
  const [after] = await audioClock(page);
  expect(after - before).toBeGreaterThan(1.5);
  await expect.poll(() => shownTime(page)).toBeGreaterThanOrEqual(1);
});

test('Pause stops the clock, and Resume carries on from the same place', async ({ page }) => {
  await play(page);
  await page.waitForTimeout(1500);
  await pauseButton(page).click();
  await expect(resumeButton(page)).toBeVisible();
  expect(await audioStates(page)).toEqual(['suspended']);
  const [held] = await audioClock(page);
  const shown = await shownTime(page);
  await page.waitForTimeout(1500);
  expect((await audioClock(page))[0]).toBeCloseTo(held, 2);
  expect(await shownTime(page)).toBe(shown);
  await resumeButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  expect(await audioStates(page)).toEqual(['running']);
  expect(await shownTime(page)).toBeLessThanOrEqual(shown + 1);
});

test('seeking moves within the song, and doesn’t set off the transition', async ({ page }) => {
  await play(page);
  await pointAtPart(page, 0.25);
  await expect.poll(() => shownTime(page)).toBeGreaterThan(15);
  expect(await shownTime(page)).toBeLessThan(30);
  await page.waitForTimeout(1500);
  await expect(title(page)).toHaveText('Morning Light');
  await expect(pauseButton(page)).toBeVisible();
});

test('seeking while paused stays paused', async ({ page }) => {
  await play(page);
  await pauseButton(page).click();
  await expect(resumeButton(page)).toBeVisible();
  await pointAtPart(page, 0.4);
  await expect.poll(() => shownTime(page)).toBeGreaterThan(25);
  await expect(resumeButton(page)).toBeVisible();
  expect(await audioStates(page)).toEqual(['suspended']);
});

test('Next and Previous go song by song, however fast they’re pressed', async ({ page }) => {
  await play(page);
  const next = page.getByRole('button', { name: 'Next song' });
  await next.click();
  await expect(title(page)).toHaveText('Slow Tide');
  await page.getByRole('button', { name: 'Previous song' }).click();
  await expect(title(page)).toHaveText('Morning Light');
  await next.click();
  await next.click();
  await next.click();
  await expect(title(page)).toHaveText('Neon Rain');
  await expect(pauseButton(page)).toBeVisible();
  await expect(next).toBeDisabled();
});

test('a transition takes over exactly where it was planned, with no gap', async ({ page, request }) => {
  await play(page);
  const { mix } = await (await request.get('/api/mix')).json();
  const seam = mix[1].seam.state;
  // what's started from the jump on is this transition. The next one may get scheduled straight after
  const earlier = await soundsStarted(page);
  await page.getByRole('button', { name: 'Jump to the transition' }).click();
  await expect(page.getByText('Jumped to just before the seam.')).toBeVisible();
  await expect(title(page)).toHaveText('Slow Tide', { timeout: 150_000 });
  await page.getByText('DJ controls', { exact: true }).click();
  await expect(page.getByRole('group', { name: 'Rate that transition' })).toBeVisible();

  const started = await page.evaluate(() => window.audioSpy.started);
  const [song, clip, after] = started.slice(earlier);
  // A stops where the plan said it would
  expect(clip.when - song.when + song.offset).toBeCloseTo(seam.a_source_start, 2);
  expect(clip.when).toBeGreaterThan(clip.at);
  // and B starts as the clip ends, at the place in B that the clip reached
  expect(after.when).toBeCloseTo(clip.when + clip.length - 0.03, 2);
  expect(after.offset).toBeCloseTo(seam.b_source_end - 0.03, 2);
  await expect(pauseButton(page)).toBeVisible();
  const [before] = await audioClock(page);
  await page.waitForTimeout(1000);
  expect((await audioClock(page))[0]).toBeGreaterThan(before);
});

test('seeking past the way out still gets to the next song', async ({ page, request }) => {
  await play(page);
  const { mix } = await (await request.get('/api/mix')).json();
  const part = (mix[1].seam.state.a_source_start + 4) / mix[0].duration;
  await pointAtPart(page, Math.min(part, 0.97));
  await expect(title(page)).toHaveText('Slow Tide', { timeout: 170_000 });
  await expect(pauseButton(page)).toBeVisible();
});

test('the end of the mix comes to a stop, and it can be played again', async ({ page }) => {
  await play(page);
  const next = page.getByRole('button', { name: 'Next song' });
  for (const song of ['Slow Tide', 'Paper Moon', 'Neon Rain']) {
    await next.click();
    await expect(title(page)).toHaveText(song);
  }
  await pointAtPart(page, 0.985);
  await expect(page.getByRole('button', { name: /^(Play|Resume from)/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(pauseButton(page)).toBeVisible();
});

test('moving around the app leaves the music alone, and the mini-player follows', async ({ page }) => {
  await play(page);
  // the transition and the next song get scheduled ahead of time, once they've loaded
  await expect.poll(() => soundsStarted(page), { timeout: 30_000 }).toBe(3);
  const started = await soundsStarted(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const place of ['Library', 'Make a Mix', 'My Mixes', 'Workspace']) {
    await nav.getByRole('link', { name: place, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.waitForTimeout(300);
  }
  expect(await soundsStarted(page)).toBe(started);
  expect(await audioStates(page)).toEqual(['running']);
  await nav.getByRole('link', { name: 'Listen', exact: true }).click();
  await expect(title(page)).toHaveText('Morning Light');
  expect(await soundsStarted(page)).toBe(started);
  expect((await page.evaluate(() => window.audioSpy.contexts.length))).toBe(1);
});

test('volume and mute change what comes out, and are remembered', async ({ page }) => {
  await play(page);
  const volume = page.getByRole('slider', { name: 'Volume' }).first();
  await volume.fill('50');
  await expect(volume).toHaveValue('50');
  await page.getByRole('button', { name: 'Mute', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Unmute', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(volume).toHaveValue('0');
  await page.getByRole('button', { name: 'Unmute', exact: true }).first().click();
  await expect(volume).toHaveValue('50');
  await page.reload();
  await expect(page.getByRole('slider', { name: 'Volume' }).first()).toHaveValue('50');
});

test('the keyboard works the player, and pressing Space on a button only does one thing', async ({ page }) => {
  await play(page);
  await page.keyboard.press('Space');
  await expect(resumeButton(page)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(pauseButton(page)).toBeVisible();
  await page.keyboard.press('Shift+N');
  await expect(title(page)).toHaveText('Slow Tide');
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Unmute', exact: true }).first()).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Mute', exact: true }).first()).toBeVisible();
  await page.keyboard.press('r');
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  await expect(drawer).toBeVisible();
  // typing in the box doesn't work the player
  await page.keyboard.type('n m');
  await expect(title(page)).toHaveText('Slow Tide');
  await expect(page.getByRole('button', { name: 'Mute', exact: true }).first()).toBeVisible();
  // The first Escape clears the active song autocomplete; the next closes Requests.
  await page.keyboard.press('Escape');
  await expect(drawer.getByRole('combobox', { name: 'Request a song' })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(pauseButton(page)).toBeVisible();
});

test('media keys do what they say', async ({ page }) => {
  await play(page);
  const press = (action: string, details: object = {}) =>
    page.evaluate(([name, extra]) => window.audioSpy.handlers[name as string]?.({ action: name, ...(extra as object) } as MediaSessionActionDetails), [action, details] as const);
  const handlers = await page.evaluate(() => Object.keys(window.audioSpy.handlers).filter((name) => window.audioSpy.handlers[name]));
  for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto']) expect(handlers).toContain(action);
  // "play" when already playing, and "pause" when already paused, change nothing
  await press('play');
  await page.waitForTimeout(200);
  await expect(pauseButton(page)).toBeVisible();
  await press('pause');
  await expect(resumeButton(page)).toBeVisible();
  await press('pause');
  await page.waitForTimeout(200);
  await expect(resumeButton(page)).toBeVisible();
  await press('play');
  await expect(pauseButton(page)).toBeVisible();
  await press('seekto', { seekTime: 40 });
  await expect.poll(() => shownTime(page)).toBeGreaterThanOrEqual(40);
  await press('nexttrack');
  await expect(title(page)).toHaveText('Slow Tide');
});

test('a preview takes the sound, and gives it back when it’s done', async ({ page }) => {
  await play(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Hear it' }).first().click();
  const preview = page.locator('audio.preview').first();
  await expect(preview).toBeVisible();
  await preview.evaluate((element: HTMLAudioElement) => element.play());
  await expect.poll(() => audioStates(page)).toEqual(['suspended']);
  expect(await preview.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await preview.evaluate((element: HTMLAudioElement) => element.pause());
  await expect.poll(() => audioStates(page)).toEqual(['running']);
});

test('only one tab plays at a time', async ({ page, context }) => {
  await play(page);
  const other = await context.newPage();
  await spyOnAudio(other);
  await other.goto('/listen');
  await play(other);
  await expect(page.getByText('Playing in another tab now.')).toBeVisible();
  await expect(resumeButton(page)).toBeVisible();
  expect(await audioStates(page)).toEqual(['suspended']);
  expect(await audioStates(other)).toEqual(['running']);
  await other.close();
});

test('lyrics follow the song, and the fullscreen view keeps everything working', async ({ page }) => {
  await play(page);
  await expect(page.getByText('the morning light comes through').first()).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.locator('.now.stage')).toBeVisible();
  await expect(page.getByText(/morning light|everything is new|hold on to the night/).first()).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.locator('.now.stage')).toHaveCount(0);
  await expect(pauseButton(page)).toBeVisible();
});

test('a song’s audio going missing says so, rather than leaving silence with no explanation', async ({ page }) => {
  await page.route('**/api/songs/*/audio', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByText('That song isn’t available.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Play|Resume from)/ })).toBeVisible();
});

test('a transition that isn’t ready doesn’t stop the music: the next song comes in over the end', async ({ page }) => {
  // the clip can't be fetched, as if its render had gone
  await page.route('**/api/seams/*/clip', (route) => route.fulfill({ status: 404, body: '{}' }));
  await play(page);
  await pointAtPart(page, 0.94);
  await expect(title(page)).toHaveText('Slow Tide', { timeout: 30_000 });
  await expect(pauseButton(page)).toBeVisible();
});
