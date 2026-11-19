import { test } from '@playwright/test';
import { listener, signedIn } from '../e2e-cloud/cloud';
test('debug', async ({ page, request }) => {
  const owner = listener('dbg');
  await signedIn(page, request, owner);
  const made = await (await page.request.post('/test/business/seed', { data: { user: owner, songs: 6 } })).json();
  page.on('response', async (r) => { if (r.url().includes('/api/') && r.status() >= 400) console.log('RESP', r.status(), r.url(), (await r.text()).slice(0, 300)); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
  await page.goto(`/b/${made.org}/v/${made.venues[0]}/requests`);
  await page.waitForTimeout(4000);
  console.log('SLIDER', await page.evaluate(() => 1));
  await page.goto(`/b/${made.org}/v/${made.venues[0]}/control`);
  await page.waitForTimeout(3000);
  console.log('SLIDERS', JSON.stringify(await page.$$eval('[role=slider], input[type=range]', (els) => els.map((e) => [e.tagName, e.getAttribute('aria-valuemax'), e.getAttribute('max'), e.getAttribute('aria-label')]))));
});
