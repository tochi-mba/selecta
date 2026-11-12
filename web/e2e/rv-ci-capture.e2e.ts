import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { spyOnAudio } from './helpers';
import { frameWindow, installProbe } from './perf-probe';

// Temporary preparation captures (rv-ci, triage WP5): design specimens, a motion trace and the
// keyboard plus measured-audio part of the CI-0165-07 protocol. Deleted after use.
const EVIDENCE = '../docs/verification/claude-checks/creative-interface/wp5';
const OUT = process.env.RVCI_OUT ?? 'rvci-out';
const SHA = process.env.RVCI_SHA ?? 'unknown';

async function settle(page: Page) {
  await page.locator('main#main').waitFor();
  await page.waitForTimeout(1200);
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
}

async function edgeVersion(page: Page) {
  return page.evaluate(async () => {
    const hints = (navigator as unknown as { userAgentData?: { getHighEntropyValues(keys: string[]): Promise<{ fullVersionList?: { brand: string; version: string }[] }> } }).userAgentData;
    const list = hints ? (await hints.getHighEntropyValues(['fullVersionList'])).fullVersionList ?? [] : [];
    return list.find((brand) => /edge/i.test(brand.brand))?.version ?? 'unknown';
  });
}

test('specimens', async ({ page }) => {
  test.skip(process.env.RVCI_PART !== 'specimens');
  const scenes = [['explore', '/mixes'], ['create', '/mix/current/edit'], ['listen', '/listen']] as const;
  const sizes = [['phone', 390, 844], ['desktop', 1440, 900]] as const;
  const shots: unknown[] = [];
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const [size, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      for (const [scene, route] of scenes) {
        await page.goto(route);
        await settle(page);
        const file = `wp5-specimen-${scene}-${size}-${theme}.png`;
        await page.screenshot({ path: `${EVIDENCE}/${file}` });
        const read = await page.evaluate(() => {
          const main = document.querySelector('main#main')!;
          const visible = (element: Element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && style.visibility !== 'hidden';
          };
          const controls = [...main.querySelectorAll('button, a[href]')].filter(visible).map((element) => {
            const rect = element.getBoundingClientRect();
            return { name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40), area: Math.round(rect.width * rect.height), top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
          }).sort((one, other) => other.area - one.area);
          const all = [...main.querySelectorAll('button, a[href], summary, [role="tab"]')].map((element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40));
          return {
            h1: document.querySelector('h1')?.textContent?.trim() ?? '',
            bodyBg: getComputedStyle(document.body).backgroundColor,
            hscroll: document.documentElement.scrollWidth > innerWidth,
            controlsInView: controls.length,
            largestControls: controls.slice(0, 4),
            controlsInMain: all.length,
            advancedReachable: all.filter((name) => /More|DJ controls|Shape|Detail|Change|Render|Download|Ask Lucy|Word connections|Harmonic/i.test(name)).slice(0, 8),
          };
        });
        shots.push({ file, scene, route, size, viewport: `${width}x${height}`, theme, ...read });
      }
    }
  }
  writeFileSync(`${EVIDENCE}/wp5-specimens.json`, `${JSON.stringify({ sha: SHA, date: '2026-11-12', browser: `Microsoft Edge ${await edgeVersion(page)} (headless)`, library: 'tests/e2e_server.py made-up library, SELECTA_E2E_STRESS=1', reducedMotion: 'reduce (to settle entrance motion before capture)', shots }, null, 1)}\n`, 'utf-8');
});

async function audioRead(page: Page) {
  return page.evaluate(() => {
    const context = window.audioSpy.contexts.at(-1) as (AudioContext & { playbackStats?: Record<string, number> }) | undefined;
    const stats = context?.playbackStats;
    return {
      state: context?.state ?? 'none',
      time: context?.currentTime ?? 0,
      stats: stats ? { underrunEvents: stats.underrunEvents, underrunDuration: stats.underrunDuration, totalDuration: stats.totalDuration } : null,
      started: window.audioSpy.started.map((sound) => ({ ...sound })),
    };
  });
}

test('motion trace', async ({ page }) => {
  test.skip(process.env.RVCI_PART !== 'trace');
  test.setTimeout(300_000);
  await installProbe(page);
  await spyOnAudio(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const windows: unknown[] = [];
  const measure = async (surface: string, ms: number, during: 'idle' | { scrollBy: number } = 'idle') => {
    const before = await audioRead(page);
    const frames = await frameWindow(page, ms, during);
    const after = await audioRead(page);
    windows.push({
      surface, ms, frames: frames.frames, frameP50: frames.frameP50, frameP95: frames.frameP95, frameWorst: frames.frameWorst,
      animations: frames.animations, longTasks: frames.longTasks, longFrames: frames.longFrames.map((frame) => frame.duration),
      audioState: after.state, audioClockPerWallSecond: Math.round(((after.time - before.time) / (ms / 1000)) * 1000) / 1000,
      underrunEventsInWindow: before.stats && after.stats ? after.stats.underrunEvents - before.stats.underrunEvents : null,
      underrunSecondsInWindow: before.stats && after.stats ? Math.round((after.stats.underrunDuration - before.stats.underrunDuration) * 1000) / 1000 : null,
      sourcesStartedInWindow: after.started.length - before.started.length,
    });
  };
  await page.goto('/listen');
  await settle(page);
  await measure('Listen, stopped (baseline)', 6000);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).first()).toBeVisible();
  await page.waitForTimeout(2000);
  await measure('Listen, playing (lyrics, visualizer, waveform)', 10000);
  await page.keyboard.press('f');
  await expect(page.locator('.now.stage')).toBeVisible();
  await page.waitForTimeout(1000);
  await measure('Stage (fullscreen lyrics and visuals), playing', 10000);
  await page.keyboard.press('Escape');
  for (const [surface, route, during] of [
    ['Make a Mix, playing, scrolling', '/mixes', { scrollBy: 6 }],
    ['Editor (Arrange), playing, scrolling', '/mix/current/edit', { scrollBy: 6 }],
    ['My Mixes, playing', '/mixes/mine', 'idle'],
    ['Library, playing, scrolling', '/library', { scrollBy: 6 }],
    ['Listen again, playing', '/listen', 'idle'],
  ] as const) {
    await page.getByRole('navigation').first().getByRole('link', { name: { '/mixes': 'Make a Mix', '/mix/current/edit': 'Edit', '/mixes/mine': 'My Mixes', '/library': 'Library', '/listen': 'Listen' }[route], exact: true }).first().click();
    await page.waitForURL(`**${route}`);
    await page.waitForTimeout(1500);
    await measure(surface, 8000, during);
  }
  const end = await audioRead(page);
  const machine = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return { gpuInfo: info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown', cores: navigator.hardwareConcurrency };
  });
  writeFileSync(`${EVIDENCE}/wp5-ci-0182-motion-trace.json`, `${JSON.stringify({
    sha: SHA, date: '2026-11-12', browser: `Microsoft Edge ${await edgeVersion(page)} (headed, real window, muted output)`,
    cpu: process.env.RVCI_CPU ?? 'unknown', gpu: machine.gpuInfo, logicalCores: machine.cores, viewport: '1440x900', theme: 'dark', reducedMotion: false,
    library: 'tests/e2e_server.py made-up library', windows,
    audio: { state: end.state, playbackStatsSupported: end.stats !== null, underrunEventsTotal: end.stats?.underrunEvents ?? null, sources: end.started.length },
    stillPlaying: await page.getByRole('button', { name: 'Pause', exact: true }).first().isVisible(),
  }, null, 1)}\n`, 'utf-8');
});

test('keyboard and measured audio (CI-0165-07)', async ({ page, request }) => {
  test.skip(process.env.RVCI_PART !== 'keyboard');
  test.setTimeout(300_000);
  await spyOnAudio(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const steps: { step: string; ok: boolean; detail: string }[] = [];
  const note = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail });
  // Tab to a named control, counting presses, so the run proves keyboard reach rather than a click
  const tabTo = async (name: RegExp, limit = 80) => {
    for (let press = 1; press <= limit; press += 1) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        return element ? (element.getAttribute('aria-label') ?? element.innerText ?? '').trim().replace(/\s+/g, ' ') : '';
      });
      if (name.test(label)) return press;
    }
    return -1;
  };
  // first play
  await page.goto('/listen');
  await settle(page);
  let presses = await tabTo(/^Play$/);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  let audio = await audioRead(page);
  note('First play: Tab to Play, Enter', presses > 0 && audio.state === 'running' && audio.started.length > 0, `${presses} Tab presses; context ${audio.state}; ${audio.started.length} sources started; first buffer ${audio.started[0]?.length.toFixed(1) ?? 0}s decoded`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  // edit: move the second song down with the keyboard
  const before = (await (await request.get('/api/mix')).json()).mix.map((item: { song: { id: number } }) => item.song.id);
  await page.goto('/mix/current/edit');
  await settle(page);
  presses = await tabTo(/^Move .* down|^Move down/i, 120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const after = (await (await request.get('/api/mix')).json()).mix.map((item: { song: { id: number } }) => item.song.id);
  note('Edit: Tab to a Move down control, Enter', presses > 0 && JSON.stringify(before) !== JSON.stringify(after), `${presses} Tab presses; order ${before.join(',')} -> ${after.join(',')}`);
  // seam preview: render one transition from the keyboard, then preview it
  presses = await tabTo(/^Render it/i, 120);
  if (presses > 0) await page.keyboard.press('Enter');
  await expect.poll(async () => (await (await request.get('/api/mix')).json()).mix.slice(1).filter((item: { seam: { state: { status: string } } | null }) => item.seam?.state.status === 'ready').length, { timeout: 240_000, intervals: [3000] }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  const startedBefore = (await audioRead(page)).started.length;
  await page.locator('body').focus();
  presses = await tabTo(/^(Hear|Play|Preview).*(transition|hand-off|seam)|^Hear it/i, 160);
  if (presses > 0) await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  audio = await audioRead(page);
  note('Seam preview: Tab to the transition preview, Enter', presses > 0 && audio.started.length > startedBefore, `${presses} Tab presses; ${audio.started.length - startedBefore} preview sources started; context ${audio.state}`);
  await page.keyboard.press('Escape');
  // request: open Request a song with the keyboard
  await page.goto('/listen');
  await settle(page);
  presses = await tabTo(/Request a song/i, 120);
  if (presses > 0) await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  const dialog = await page.getByRole('dialog').count();
  note('Request: Tab to Request a song, Enter', presses > 0 && dialog > 0, `${presses} Tab presses; dialog open: ${dialog > 0}`);
  await page.keyboard.press('Escape');
  // export: reach Download audio on the editor
  await page.goto('/mix/current/edit');
  await settle(page);
  presses = await tabTo(/Download audio/i, 80);
  note('Export: Tab reaches Download audio', presses > 0, `${presses} Tab presses (not activated: a download needs the owner's OK)`);
  // measured playthrough across a seam: render all, play from the top, seek near the first seam
  await request.post('/api/mix/render');
  await expect.poll(async () => (await (await request.get('/api/mix')).json()).mix.slice(1).filter((item: { seam: { state: { status: string } } | null }) => item.seam?.state.status !== 'ready').length, { timeout: 280_000, intervals: [3000] }).toBe(0);
  await page.goto('/listen');
  await settle(page);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.waitForTimeout(2000);
  const slider = page.getByRole('slider', { name: 'Where in the song' });
  await slider.focus();
  await page.keyboard.press('End');
  for (let step = 0; step < 6; step += 1) await page.keyboard.press('ArrowLeft');
  const statsStart = await audioRead(page);
  await page.waitForTimeout(45_000);
  const statsEnd = await audioRead(page);
  const sorted = statsEnd.started.filter((sound) => sound.length > 0).sort((one, other) => one.when - other.when);
  const gaps = sorted.slice(1).map((sound, index) => {
    const prior = sorted[index];
    const priorEnd = prior.when + (prior.duration ?? prior.length - prior.offset);
    return Math.round((sound.when - priorEnd) * 1000);
  });
  note('Measured playthrough across a seam', statsEnd.state === 'running' && (statsEnd.stats ? statsEnd.stats.underrunEvents === (statsStart.stats?.underrunEvents ?? 0) : true) && statsEnd.time - statsStart.time > 40,
    `audio clock advanced ${(statsEnd.time - statsStart.time).toFixed(1)}s in 45s; ${statsEnd.started.length} sources decoded (all non-empty: ${statsEnd.started.every((sound) => sound.length > 0)}); underruns in window ${statsEnd.stats && statsStart.stats ? statsEnd.stats.underrunEvents - statsStart.stats.underrunEvents : 'n/a'}; schedule gaps between consecutive sources (ms, negative = overlap) ${gaps.join(', ')}`);
  writeFileSync(`${OUT}/keyboard.json`, JSON.stringify({ sha: SHA, browser: await edgeVersion(page), steps }, null, 1), 'utf-8');
});
