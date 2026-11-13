import { writeFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * MI-0140-08: moving between pages and opening and closing dialogs, sheets and the command palette never
 * makes a second AudioContext, never suspends or closes the one there is, and never leaves a gap in the
 * scheduled sound. The trace below records every AudioContext made, every state it goes through, every
 * buffer it starts and stops, and the audio and wall clocks every 100 ms. It reads the Web Audio graph,
 * not the speakers: a captured recording of the real output, listened to for dropouts, needs a person.
 */
type Source = { start: number; offset: number; length: number; stopAt: number | null; endedAt: number | null };
type Trace = {
  made: number;
  states: { state: string; wall: number }[];
  sources: Source[];
  samples: { wall: number; audio: number; state: string }[];
};

declare global {
  interface Window {
    audioTrace: Trace;
  }
}

async function traceAudio(page: Page) {
  await page.addInitScript(() => {
    const trace: Trace = { made: 0, states: [], sources: [], samples: [] };
    window.audioTrace = trace;
    const contexts: AudioContext[] = [];
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        trace.made += 1;
        contexts.push(this);
        trace.states.push({ state: this.state, wall: performance.now() });
        // Chromium can fire a statechange that leaves the state as it was (running, then running again
        // as its render thread settles); only a real change is a change
        let last = this.state;
        this.addEventListener('statechange', () => {
          if (this.state === last) return;
          last = this.state;
          trace.states.push({ state: this.state, wall: performance.now() });
        });
      }
    };
    const records = new WeakMap<AudioBufferSourceNode, Source>();
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function started(when = 0, offset = 0, duration?: number) {
      const record: Source = { start: Math.max(when, this.context.currentTime), offset, length: duration ?? (this.buffer?.duration ?? 0) - offset, stopAt: null, endedAt: null };
      records.set(this, record);
      trace.sources.push(record);
      this.addEventListener('ended', () => { record.endedAt = this.context.currentTime; });
      return duration === undefined ? start.call(this, when, offset) : start.call(this, when, offset, duration);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function stopped(when = 0) {
      const record = records.get(this);
      // a later stop replaces an earlier one, as it does in the browser
      if (record) record.stopAt = Math.max(when, this.context.currentTime);
      return stop.call(this, when);
    };
    window.setInterval(() => {
      const context = contexts[0];
      if (context) trace.samples.push({ wall: performance.now(), audio: context.currentTime, state: context.state });
    }, 100);
  });
}

/** The song's time as the page shows it: under the waveform on Listen, in the mini-player elsewhere. */
async function shownSeconds(page: Page): Promise<number> {
  const words = await page.evaluate(() => {
    const slider = document.querySelector('[role="slider"][aria-label="Where in the song"]');
    return slider?.getAttribute('aria-valuetext') ?? document.querySelector('.mini .mini-song span')?.textContent ?? '';
  });
  const match = /(\d+):(\d+)/.exec(words);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

const pause = (page: Page) => page.getByRole('button', { name: 'Pause', exact: true }).first();

test('MI-0140-08 every route, dialog, sheet and the command palette leave one AudioContext running and the sound unbroken', async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await traceAudio(page);
  await resetMix(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/listen');
  await expect(page.locator('h1.display')).toHaveText('Morning Light');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(pause(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => shownSeconds(page)).toBeGreaterThanOrEqual(1);

  const steps: { where: string; wall: number; audio: number; shown: number; contexts: number; state: string }[] = [];
  const mark = async (where: string) => {
    await expect(pause(page), `${where}: the player no longer says it is playing`).toBeVisible();
    const reading = await page.evaluate(() => {
      const last = window.audioTrace.samples[window.audioTrace.samples.length - 1];
      return { wall: performance.now(), audio: last?.audio ?? -1, contexts: window.audioTrace.made, state: last?.state ?? 'none' };
    });
    // Listen draws its seek strip a moment after its title; the time is read once a readout is there
    await expect.poll(() => shownSeconds(page), { message: `${where}: no time shown`, timeout: 5_000 }).toBeGreaterThanOrEqual(0);
    steps.push({ where, ...reading, shown: await shownSeconds(page) });
  };
  const nav = page.getByRole('navigation', { name: 'Main' });
  const go = async (name: string, heading?: RegExp) => {
    await nav.getByRole('link', { name, exact: true }).click();
    if (heading) await expect(page.locator('main#main h1').first()).toHaveText(heading);
    await mark(name);
  };
  const dialog = async (opener: () => Promise<void>, name: string | RegExp, close: 'Escape' | 'button' = 'Escape') => {
    await opener();
    const sheet = page.getByRole('dialog', { name });
    await expect(sheet).toBeVisible();
    await mark(`${name} open`);
    if (close === 'Escape') await page.keyboard.press('Escape');
    else await sheet.getByRole('button', { name: /^Close/ }).first().click();
    await expect(sheet).toHaveCount(0);
    await mark(`${name} closed`);
  };
  const command = async (label: RegExp) => {
    await page.keyboard.press('Control+K');
    const palette = page.getByRole('dialog', { name: 'Search and commands' });
    await expect(palette).toBeVisible();
    await mark('command palette open');
    await palette.getByRole('combobox').fill(label.source.replace(/\\/g, ''));
    await palette.getByRole('option', { name: label }).first().click();
    await expect(palette).toHaveCount(0);
  };

  await mark('Listen');
  await dialog(() => page.getByRole('button', { name: /^Requests/ }).first().click(), 'Requests');

  await go('Make a Mix');
  const customize = page.getByRole('button', { name: 'Customize' });
  if (await customize.count()) await dialog(() => customize.click(), 'Shape the next mix');

  await go('My Mixes');

  await command(/Edit current mix/);
  await expect(page).toHaveURL(/\/mix\/current\/edit$/);
  await mark('editor');
  await page.getByRole('button', { name: 'More for Paper Moon' }).click();
  await expect(page.getByRole('menuitem', { name: 'Remove Paper Moon' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Remove Paper Moon' })).toHaveCount(0);
  await mark('editor menu');
  const download = page.getByRole('button', { name: 'Download audio' });
  if (await download.count()) await dialog(() => download.click(), 'Save as an audio file');

  await go('Library');
  await dialog(() => page.getByRole('button', { name: 'Details for Paper Moon', exact: true }).first().click(), /Paper Moon/, 'button');

  await go('Workspace');
  for (const tab of ['Analysis', 'Storage', 'Sources']) {
    const link = page.getByRole('link', { name: tab, exact: true }).first();
    if (!(await link.count())) continue;
    await link.click();
    await mark(`Workspace ${tab}`);
  }

  const activity = page.getByRole('button', { name: /^Activity/ }).first();
  if (await activity.count()) await dialog(() => activity.click(), /Activity/);
  const help = page.getByRole('button', { name: 'Keyboard shortcuts' }).first();
  if (await help.count()) await dialog(() => help.click(), /Keyboard shortcuts/);

  // the server says which features this build has in /api/status; Lucy is a page of its own when it's on
  const status = await (await page.request.get('/api/status')).json();
  if (status.flags?.lucy === true) {
    await command(/Make a mix with Lucy/);
    await expect(page).toHaveURL(/\/mixes\/lucy/);
    await mark('Lucy');
  }

  // the browser's own Back and Forward move between pages without reloading
  await page.goBack();
  await mark('Back');
  await page.goForward();
  await mark('Forward');

  await go('Listen', /Morning Light/);
  await expect(pause(page)).toBeVisible();

  // a fast machine walks every step in under ten seconds; the music plays on until the session is long
  // enough to measure the audio clock against the wall clock
  await expect.poll(() => page.evaluate(() => performance.now()), { timeout: 20_000 }).toBeGreaterThan(steps[0].wall + 11_000);
  await mark('Listen, after a while');
  const trace = await page.evaluate(() => window.audioTrace);
  // Player.prepare() is allowed to pre-open a browser AudioContext while idle:
  // autoplay-enabled Edge may report running -> suspended before the first Play.
  // Judge continuity from the first playing checkpoint, not that preparation.
  const firstRunning = trace.states.findLastIndex(
    (entry) => entry.state === 'running' && entry.wall <= steps[0].wall,
  );
  const report = { steps, made: trace.made, states: trace.states, sources: trace.sources, samples: trace.samples.length };
  writeFileSync(info.outputPath('mi-0140-08-trace.json'), JSON.stringify(report, null, 2));

  // exactly one AudioContext, running from the first press to the end, never suspended or closed
  expect(trace.made, 'AudioContexts made').toBe(1);
  expect(firstRunning, 'the context never ran').toBeGreaterThanOrEqual(0);
  expect(trace.states.slice(firstRunning + 1).map((entry) => entry.state), 'state changes after it started').toEqual([]);
  const walk = trace.samples.filter((sample) => sample.wall >= steps[0].wall);
  expect(walk.every((sample) => sample.state === 'running'), 'a sample found the context not running').toBe(true);

  // the audio clock keeps pace with the wall clock across every step
  const walkWall = (walk[walk.length - 1].wall - walk[0].wall) / 1000;
  const walkAudio = walk[walk.length - 1].audio - walk[0].audio;
  expect(walkWall, 'the walk is a real session, not a blink').toBeGreaterThan(10);
  expect(walkAudio / walkWall, 'audio clock against wall clock').toBeGreaterThan(0.9);
  let worst = 0;
  for (let index = 1; index < walk.length; index += 1) {
    const wall = (walk[index].wall - walk[index - 1].wall) / 1000;
    const audio = walk[index].audio - walk[index - 1].audio;
    worst = Math.max(worst, wall - audio);
  }
  expect(worst, 'the longest the audio clock stood still while time went on (s)').toBeLessThan(0.5);

  // something was always scheduled to sound: no gap between the sources across the walk
  const from = walk[0].audio;
  const to = walk[walk.length - 1].audio;
  const spans = trace.sources
    .map((source) => ({ start: source.start, end: Math.min(source.start + source.length, source.stopAt ?? Infinity, source.endedAt ?? Infinity) }))
    .filter((span) => span.end > from && span.start < to)
    .sort((one, other) => one.start - other.start);
  expect(spans.length, 'nothing was playing during the walk').toBeGreaterThan(0);
  let covered = from;
  for (const span of spans) {
    expect(span.start, `silence from ${covered.toFixed(2)}s`).toBeLessThanOrEqual(covered + 0.05);
    covered = Math.max(covered, span.end);
  }
  expect(covered, 'the sound stopped before the walk ended').toBeGreaterThanOrEqual(to);
  // no song was started again from somewhere else because a page changed
  expect(trace.sources.filter((source) => source.start >= from && source.start <= to && source.offset > 0), 'a song restarted mid-walk').toEqual([]);

  // the time shown never goes backwards and keeps up with the music
  const shown = steps.map((step) => step.shown);
  expect(shown.every((value) => value >= 0), `time not shown at ${steps.filter((step) => step.shown < 0).map((step) => step.where).join(', ')}`).toBe(true);
  for (let index = 1; index < shown.length; index += 1) {
    expect(shown[index], `${steps[index].where}: the shown time went back`).toBeGreaterThanOrEqual(shown[index - 1]);
  }
  expect(shown[shown.length - 1] - shown[0], 'shown time against the walk').toBeGreaterThanOrEqual(Math.floor(walkAudio) - 2);
  expect(steps.every((step) => step.contexts === 1)).toBe(true);
  expect(problems).toEqual([]);
});
