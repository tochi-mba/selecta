// WP4 scratch: cognitive-walkthrough pilot of U1-U6 on the made-up library. Deleted after use.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = 'http://127.0.0.1:9770';
const shots = '../docs/verification/claude-checks/unified-finish/wp4-pilot/';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
const log = {};
const names = (scope = 'body') => page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} a, ${s} [role=menuitem], ${s} [role=option], ${s} input, ${s} [role=dialog] h2`)].filter((e) => e.offsetParent !== null).map((e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 80)).filter(Boolean), scope);
const say = (k, v) => { (log[k] ??= []).push(v); console.log(k, typeof v === 'string' ? v : JSON.stringify(v).slice(0, 600)); };
async function step(k, fn) { try { await fn(); } catch (e) { say(k, 'ERROR ' + String(e).split('\n')[0]); } }

await step('U1', async () => {
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  say('U1', 'start ' + page.url());
  await page.locator('main button', { hasText: /^Play$/ }).first().click();
  await page.waitForTimeout(1500);
  const dialog = page.locator('[role=dialog], [role=alertdialog]');
  if (await dialog.count()) { say('U1', { dialog: (await dialog.first().innerText()).slice(0, 400) }); }
  await page.waitForTimeout(4000);
  say('U1', { url: page.url(), transport: (await names('footer, [aria-label*=layer i], .transport')).slice(0, 12) });
  await page.screenshot({ path: shots + 'u1-after-play.png' });
});
await step('U2', async () => {
  await page.goto(base + '/library', { waitUntil: 'networkidle' });
  await page.getByRole('searchbox').or(page.getByPlaceholder(/Search your library/)).first().fill('Same Name');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shots + 'u2-search.png' });
  await page.getByRole('button', { name: 'More actions for Same Name by Iris Vale' }).click();
  await page.waitForTimeout(600);
  say('U2', { menu: (await names('[role=menu], .menu, [role=dialog]')) });
  const start = page.getByRole('button', { name: /Start a mix/ }).or(page.getByRole('menuitem', { name: /Start a mix/ }));
  say('U2', { startAMixButtons: await start.count() });
});
await step('U3', async () => {
  await page.goto(base + '/mixes/lucy', { waitUntil: 'networkidle' });
  const box = page.getByRole('textbox', { name: /Message to Lucy/ });
  await box.fill('a calm mix');
  await box.press('Enter');
  await page.getByRole('button', { name: /Save as draft/ }).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  say('U3', { proposal: (await page.locator('main').innerText()).slice(-1600) });
  await page.screenshot({ path: shots + 'u3-proposal.png' });
  await page.getByRole('button', { name: /Save as draft/ }).first().click();
  await page.waitForTimeout(2500);
  say('U3', { afterSave: (await page.locator('main').innerText()).slice(-500) });
  await page.goto(base + '/mixes/mine', { waitUntil: 'networkidle' });
  say('U3', { mine: (await page.locator('main').innerText()).slice(0, 800) });
});
await step('U4', async () => {
  await page.goto(base + '/mix/current/edit', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Let SelectaDJ pick/ }).nth(1).click();
  await page.waitForTimeout(1500);
  say('U4', { seamPanel: (await names('main')).filter((n) => /earlier|later|cue|start|leave|bring|bar|move|length|Change/i.test(n)).slice(0, 30) });
  await page.screenshot({ path: shots + 'u4-seam.png' });
});
await step('U5', async () => {
  await page.getByRole('button', { name: /^Requests/ }).first().click();
  await page.waitForTimeout(1500);
  say('U5', { requests: (await names('[role=dialog], aside, .requests')).slice(0, 30) });
  await page.screenshot({ path: shots + 'u5-requests.png' });
  await page.keyboard.press('Escape');
});
await step('U6', async () => {
  await page.goto(base + '/mix/current/edit', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Download audio/ }).click();
  await page.waitForTimeout(1500);
  say('U6', { download: (await page.locator('[role=dialog], main').first().innerText()).slice(0, 900) });
  await page.screenshot({ path: shots + 'u6-download.png' });
});
fs.writeFileSync('wp4probe/pilot.json', JSON.stringify(log, null, 1));
await browser.close();
