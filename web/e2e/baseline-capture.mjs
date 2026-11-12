// T0001: the browser half of tests/baseline_capture.py. Opens the pre-redesign (911c981) page that
// the script is serving, saves a screenshot of each main view at desktop and phone width, then plays
// the mix and records every sound the page starts and every audio file it fetches.
//
//     node e2e/baseline-capture.mjs http://127.0.0.1:8931 ../docs/baseline/911c981
//
// Prints one JSON line: the screenshot files and what the page keeps in the browser.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const [base, out] = process.argv.slice(2);
const VIEWS = ['Mixes', 'Now', 'Edit', 'Library', 'Words', 'Workshop'];
const WIDTHS = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } };
const PLAY_MS = 20_000;

mkdirSync(join(out, 'screens'), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const screens = [];
try {
  for (const [size, viewport] of Object.entries(WIDTHS)) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.goto(base);
    await page.getByRole('navigation', { name: 'Main' }).waitFor();
    for (const view of VIEWS) {
      await page.getByRole('button', { name: view, exact: true }).first().click();
      await page.waitForTimeout(1500);
      const file = `screens/${view.toLowerCase()}-${size}.png`;
      await page.screenshot({ path: join(out, file), fullPage: true, animations: 'disabled' });
      screens.push(file);
    }
    await page.close();
  }

  // the playback trace: sounds started on the audio clock, and the audio the player asked for
  const page = await browser.newPage({ viewport: WIDTHS.desktop });
  await page.addInitScript(() => {
    const trace = { started: [], states: [] };
    window.baselineTrace = trace;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options) {
        super(options);
        trace.states.push({ at: performance.now(), state: this.state, sampleRate: this.sampleRate });
        this.addEventListener('statechange', () => trace.states.push({ at: performance.now(), state: this.state }));
      }
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function started(when = 0, offset = 0, duration) {
      trace.started.push({ wall_ms: performance.now(), clock: this.context.currentTime, when, offset, duration: duration ?? null, length: this.buffer?.duration ?? 0 });
      return duration === undefined ? start.call(this, when, offset) : start.call(this, when, offset, duration);
    };
  });
  const fetched = [];
  const t0 = Date.now();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (/\/api\/(songs\/\d+\/audio|seams\/[^/]+\/clip)$/.test(path)) fetched.push({ ms: Date.now() - t0, path, status: response.status() });
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Now', exact: true }).first().click();
  const mix = await (await page.request.get(`${base}/api/mix`)).json();
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.waitForTimeout(PLAY_MS);
  const trace = await page.evaluate(() => window.baselineTrace);
  writeFileSync(join(out, 'playback-trace.json'), JSON.stringify({
    played_ms: PLAY_MS,
    mix: mix.mix.map((item) => ({ song_id: item.song_id, title: item.title, seam: item.seam ? { key: item.seam.key, move: item.seam.move ?? item.seam.style ?? null, status: item.seam.status ?? null } : null })),
    audio_context: trace.states,
    sounds_started: trace.started,
    audio_fetched: fetched,
  }, null, 1));
  const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])));
  await page.close();
  console.log(JSON.stringify({ screens, storage }));
} finally {
  await browser.close();
}
