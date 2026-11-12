import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = 'http://127.0.0.1:9780';
const out = process.argv[2];
const routes = process.argv.slice(3);
const b = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
for (const r of routes) {
  await p.goto(base + r);
  await p.waitForTimeout(2500);
  const snap = await p.locator('main').first().ariaSnapshot().catch(e => 'ERR ' + e);
  fs.writeFileSync(`${out}/aria${r.replace(/[\/?=&]/g, '_')}.yaml`, snap);
}
await b.close();
