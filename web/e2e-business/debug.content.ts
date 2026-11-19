import { expect, test } from '@playwright/test';
import { listener, signedIn } from '../e2e-cloud/cloud';
test('debug', async ({ page, request }) => {
  const owner = listener('dbg');
  await signedIn(page, request, owner);
  const made = await (await page.request.post('/test/business/seed', { data: { user: owner, songs: 6 } })).json();
  page.on('response', async (r) => { if (r.url().includes('content/rules') || r.url().includes('overview')) console.log('RESP', r.request().method(), r.status(), r.url().slice(-60), (await r.text()).slice(0, 400)); });
  await page.goto(`/b/${made.org}/v/${made.venues[0]}/rules`);
  await page.getByLabel('Highest volume in Bar').fill('60');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await page.getByRole('button', { name: 'Save anyway' }).click();
  await page.waitForTimeout(2000);
  await page.goto(`/b/${made.org}/v/${made.venues[0]}/control`);
  await page.waitForTimeout(3000);
});
