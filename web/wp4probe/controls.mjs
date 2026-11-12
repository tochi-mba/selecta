import { chromium } from '@playwright/test';
const base = 'http://127.0.0.1:9770';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
for (const route of process.argv.slice(2)) {
  await page.goto(base + route, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1000);
  const names = await page.evaluate(() => [...document.querySelectorAll('main button, main a, main [role=button], main input, main select, header button')].map((e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 70)).filter(Boolean));
  console.log('###', route, [...new Set(names)].join(' | '));
}
await browser.close();
