// CI-0182-07: motion surfaces while the music plays, headed Edge on this PC (real GPU compositing).
// Motion is NOT reduced. Per surface: rAF frame intervals, long tasks, long animation frames,
// running animations, the audio clock against the wall clock, the context state, Chromium's
// playback stats where exposed, and every source the player started or stopped.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = process.env.BASE ?? 'http://127.0.0.1:9781';
const out = process.argv[2];
const b = await chromium.launch({ channel: 'msedge', headless: false, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', colorScheme: 'dark' });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const log = { contexts: [], sources: [], longTasks: [], longFrames: [] };
  window.wp5 = log;
  const Real = window.AudioContext;
  window.AudioContext = class extends Real { constructor(o) { super(o); log.contexts.push(this); } };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, d) {
    log.sources.push({ at: this.context.currentTime, when, offset, length: this.buffer?.duration ?? 0, wall: performance.now() });
    return d === undefined ? start.call(this, when, offset) : start.call(this, when, offset, d);
  };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) log.longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) log.longFrames.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch {}
});
const go = (path) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, path);
async function windowOf(name, ms, during) {
  const r = await page.evaluate(async ({ ms, during }) => {
    const c = window.wp5.contexts[0];
    const stats0 = c?.playbackStats ? { ...c.playbackStats.toJSON?.() ?? {} } : null;
    const clock0 = c ? c.currentTime : 0;
    const begun = performance.now();
    const animations = document.getAnimations().filter((a) => a.playState === 'running').length;
    const frames = []; let last = begun;
    await new Promise((done) => { const step = (now) => { frames.push(now - last); last = now; if (during) { const room = document.documentElement.scrollHeight - innerHeight; scrollBy(0, scrollY >= room - 1 ? -room : during); } if (now - begun < ms) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
    const ended = performance.now();
    const clock1 = c ? c.currentTime : 0;
    const stats1 = c?.playbackStats ? { ...c.playbackStats.toJSON?.() ?? {} } : null;
    const f = frames.slice(1).sort((x, y) => x - y);
    const at = (s) => f.length ? Math.round(f[Math.min(Math.floor(f.length * s), f.length - 1)] * 10) / 10 : 0;
    const inside = (t) => t >= begun && t <= ended;
    return {
      ms: Math.round(ended - begun), frames: f.length, frameP50: at(0.5), frameP95: at(0.95), frameWorst: Math.round((f.at(-1) ?? 0) * 10) / 10,
      animations,
      longTasks: window.wp5.longTasks.filter((t) => inside(t.start)).map((t) => Math.round(t.duration)),
      longFrames: window.wp5.longFrames.filter((t) => inside(t.start)).map((t) => Math.round(t.duration)),
      audioState: c?.state ?? 'none', audioClockPerWallSecond: c ? Math.round(((clock1 - clock0) / ((ended - begun) / 1000)) * 1000) / 1000 : null,
      playbackStatsBefore: stats0, playbackStatsAfter: stats1,
      sourcesStartedInWindow: window.wp5.sources.filter((s) => inside(s.wall)).length,
    };
  }, { ms, during });
  return { surface: name, ...r };
}
const cpu = process.env.CPU_NAME ?? 'unknown';
const gpu = process.env.GPU_NAME ?? 'unknown';
const report = { when: new Date().toISOString(), browser: `Microsoft Edge ${b.version()} (headed, real window)`, cpu, gpu, viewport: '1440x900', theme: 'dark', reducedMotion: false, windows: [] };
await page.goto(base + '/listen');
await page.waitForTimeout(2500);
report.windows.push(await windowOf('Listen, stopped (baseline)', 6000));
await page.getByRole('button', { name: /^(Play|Resume from)/ }).first().click();
await page.getByRole('button', { name: 'Pause', exact: true }).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
report.gpuInfo = await page.evaluate(() => { try { const g = document.createElement('canvas').getContext('webgl'); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'no debug info'; } catch (e) { return String(e); } });
report.windows.push(await windowOf('Listen, playing (lyrics, visualizer, waveform)', 10000));
await page.keyboard.press('f');
await page.locator('.now.stage').waitFor({ timeout: 10000 }).catch(() => {});
report.windows.push(await windowOf('Stage (fullscreen lyrics and visuals), playing', 10000));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await go('/mixes');
await page.waitForTimeout(1500);
report.windows.push(await windowOf('Make a Mix, playing, scrolling', 10000, 40));
await go('/mix/current/edit');
await page.waitForTimeout(1500);
report.windows.push(await windowOf('Editor (Arrange), playing, scrolling', 10000, 40));
await go('/mixes/mine');
await page.waitForTimeout(1500);
report.windows.push(await windowOf('My Mixes, playing', 8000));
await go('/library');
await page.waitForTimeout(1500);
report.windows.push(await windowOf('Library, playing, scrolling', 8000, 60));
await go('/listen');
await page.waitForTimeout(1000);
report.windows.push(await windowOf('Listen again, playing', 8000));
report.sources = await page.evaluate(() => window.wp5.sources.map((s) => ({ at: Math.round(s.at * 1000) / 1000, when: Math.round(s.when * 1000) / 1000, offset: Math.round(s.offset * 1000) / 1000, length: Math.round(s.length * 10) / 10 })));
report.audio = await page.evaluate(() => { const c = window.wp5.contexts[0]; return c ? { state: c.state, sampleRate: c.sampleRate, baseLatencyMs: Math.round(c.baseLatency * 10000) / 10, outputLatencyMs: Math.round((c.outputLatency ?? 0) * 10000) / 10, playbackStatsSupported: 'playbackStats' in c } : null; });
report.stillPlaying = await page.getByRole('button', { name: 'Pause', exact: true }).first().isVisible();
fs.writeFileSync(out, JSON.stringify(report, null, 1));
await b.close();
console.log('ok');
