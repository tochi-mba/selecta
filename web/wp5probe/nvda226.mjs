// S31 gate line 226: headed Edge under NVDA 2026.3.1, browse mode and live announcements on the
// made-up library (tests/e2e_server.py). NVDA speech is logged by nvda_run.ps1; this only drives keys.
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://127.0.0.1:9781';
const b = await chromium.launch({ channel: 'msedge', headless: false, args: ['--mute-audio', '--force-renderer-accessibility', '--start-maximized'] });
const ctx = await b.newContext({ viewport: null, reducedMotion: 'reduce', colorScheme: 'light' });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const key = async (k, n = 1, gap = 1500) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await wait(gap); } };
const mark = (t) => console.log(`MARK ${new Date().toISOString()} ${t}`);
await page.bringToFront();
// 1. Make a Mix: browse mode, headings with h
mark('mixes headings');
await page.goto(base + '/mixes'); await wait(5000);
await page.locator('main h1').click(); await wait(1500);
await key('h', 6);
// landmarks with d
mark('landmarks');
await key('d', 4);
// 2. My Mixes: read-all of the page from its heading
mark('my mixes read all');
await page.goto(base + '/mixes/mine'); await wait(5000);
await page.locator('main h1').click(); await wait(1000);
await page.keyboard.press('Insert+ArrowDown'); await wait(20000);
await page.keyboard.press('Control'); await wait(1000);
// 3. Library: filter buttons by Tab, live count announcement
mark('library filters');
await page.goto(base + '/library'); await wait(5000);
await page.getByRole('group', { name: 'Filter Library recordings' }).getByRole('button', { name: 'Everything' }).focus(); await wait(2000);
await key('Tab', 1, 2000);
await key('Space', 1, 3000);
await key('Tab', 1, 2000);
await key('Space', 1, 3000);
// 4. Listen: play, Next song, live now-playing announcement
mark('listen next');
await page.goto(base + '/listen'); await wait(5000);
const play = page.getByRole('button', { name: /^(Play|Resume from)/ }).first();
await play.focus(); await wait(1500);
await key('Enter', 1, 5000);
await page.getByRole('button', { name: 'Next song' }).focus(); await wait(2000);
await key('Enter', 1, 6000);
await page.getByRole('button', { name: 'Pause', exact: true }).first().focus(); await wait(1500);
await key('Enter', 1, 2000);
// 5. editor: the "What you're editing" group and View radios by keyboard
mark('editor view radios');
await page.goto(base + '/mix/current/edit'); await wait(5000);
await page.getByRole('radio', { name: 'Arrange' }).focus(); await wait(2000);
await key('ArrowRight', 1, 2500);
await key('ArrowLeft', 1, 2500);
mark('done');
await b.close();
