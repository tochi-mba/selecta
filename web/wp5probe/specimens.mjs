// CI-0165-02 design specimens: Explore (Make a Mix), Create (editor), Listen; light/dark; phone/desktop.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = process.env.BASE ?? 'http://127.0.0.1:9780';
const out = process.argv[2];
const scenes = { explore: '/mixes', create: '/mix/current/edit', listen: '/listen' };
const sizes = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true }, desktop: { width: 1440, height: 900 } };
const b = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const report = { browser: b.version(), shots: [] };
for (const [sizeName, s] of Object.entries(sizes)) for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: s.width, height: s.height }, isMobile: !!s.isMobile, hasTouch: !!s.hasTouch, colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  for (const [scene, route] of Object.entries(scenes)) {
    await p.goto(base + route);
    await p.waitForTimeout(3000);
    const file = `wp5-specimen-${scene}-${sizeName}-${theme}.png`;
    await p.screenshot({ path: `${out}/${file}` });
    const m = await p.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && cs.visibility !== 'hidden'; };
      const main = document.querySelector('main');
      const btns = [...main.querySelectorAll('button, a[href]')].filter(vis);
      const prim = btns.filter((e) => e.classList.contains('primary'));
      const h1 = main.querySelector('h1');
      const big = btns.map((e) => { const r = e.getBoundingClientRect(); return { name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60), area: Math.round(r.width * r.height), top: Math.round(r.top), primary: e.classList.contains('primary') }; }).sort((a, z) => z.area - a.area).slice(0, 5);
      return { theme: document.documentElement.dataset.theme, h1: h1 ? h1.textContent.trim().slice(0, 80) : null, h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null, controlsInView: btns.length, primaryInView: prim.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60)), largestControls: big, hscroll: document.documentElement.scrollWidth > innerWidth };
    });
    report.shots.push({ file, scene, route, size: sizeName, viewport: `${s.width}x${s.height}`, theme, ...m });
  }
  await ctx.close();
}
fs.writeFileSync(`${out}/wp5-specimens.json`, JSON.stringify(report, null, 1));
await b.close();
