// Cognitive-walkthrough pilot, part 1: drive each card's intended path on the made-up library and
// record whether each step can be reached, plus the words the participant would read there.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = process.env.BASE ?? 'http://127.0.0.1:9781';
const out = process.argv[2];
const b = await chromium.launch({ channel: 'msedge', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', colorScheme: 'light' });
const page = await ctx.newPage();
const log = {};
const t0 = () => Date.now();
async function step(card, name, fn) {
  const s = t0();
  try { const r = await fn(); (log[card] ??= []).push({ step: name, ok: true, ms: Date.now() - s, ...(r && typeof r === 'object' ? r : { note: r ?? null }) }); }
  catch (e) { (log[card] ??= []).push({ step: name, ok: false, ms: Date.now() - s, error: String(e).split('\n')[0].slice(0, 300) }); }
}
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').slice(0, 900);
const aria = async (loc) => (await loc.ariaSnapshot()).slice(0, 2500);

// first run (status reports nothing added, as web/e2e/finishing.e2e.ts does)
await page.route('**/api/status', async (route) => {
  const answer = await route.fetch(); const status = await answer.json();
  await route.fulfill({ response: answer, json: { ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 } } });
});
await step('first-run', 'open /', async () => { await page.goto(base + '/'); await page.waitForTimeout(2500); await shot('first-run'); return { main: await text(page.locator('main')) }; });
await step('first-run', 'folder field and its help', async () => ({ aria: await aria(page.locator('main')) }));
await step('first-run', 'type a folder that does not exist and start', async () => {
  const field = page.getByRole('textbox').first();
  await field.fill('C:\\no-such-folder-wp5');
  await page.getByRole('button', { name: /^Start|Add|Use this folder/ }).first().click();
  await page.waitForTimeout(2500); await shot('first-run-rejected');
  return { main: await text(page.locator('main')) };
});
await page.unroute('**/api/status');

// Make a Mix: featured pick, cards, shape panel, Play confirmation
await step('make-a-mix', 'open /mixes', async () => { await page.goto(base + '/mixes'); await page.waitForTimeout(2500); await shot('mixes'); return { featured: await text(page.getByRole('region', { name: 'Listen now, shape later' })) }; });
await step('make-a-mix', 'open Shape this mix', async () => {
  await page.getByRole('button', { name: /Shape this mix/ }).click(); await page.waitForTimeout(800); await shot('mixes-shape');
  return { aria: await aria(page.getByRole('region', { name: 'Listen now, shape later' })) };
});
await step('make-a-mix', 'House party: Why? details', async () => {
  const card = page.locator('article', { has: page.getByRole('heading', { name: 'House party' }) });
  await card.locator('summary').first().click(); await page.waitForTimeout(500);
  return { card: await text(card) };
});
await step('make-a-mix', 'House party: Play while a current mix exists', async () => {
  const card = page.locator('article', { has: page.getByRole('heading', { name: 'House party' }) });
  await card.getByRole('button', { name: 'Play', exact: true }).click(); await page.waitForTimeout(1500); await shot('mixes-replace-ask');
  const dlg = page.getByRole('dialog').or(page.getByRole('alertdialog')).first();
  return { dialog: (await dlg.count()) ? await text(dlg) : 'no dialog', url: page.url() };
});
await step('make-a-mix', 'keep the current mix (cancel)', async () => {
  const dlg = page.getByRole('dialog').or(page.getByRole('alertdialog')).first();
  if (await dlg.count()) { await dlg.getByRole('button', { name: /Cancel|Keep|Not now|Back/ }).first().click(); }
  await page.waitForTimeout(800); return { url: page.url() };
});
await step('make-a-mix', 'filter The mood', async () => {
  await page.getByRole('group', { name: 'Filter mix feelings' }).getByRole('button', { name: 'The mood' }).click(); await page.waitForTimeout(500);
  return { headings: await page.locator('article h3').allInnerTexts() };
});

// Listen: play, Next vs Jump to the transition, Up next, steering
await step('listen', 'open /listen and press Play', async () => {
  await page.goto(base + '/listen'); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).first().click();
  await page.getByRole('button', { name: 'Pause', exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500); await shot('listen-playing');
  return { transport: await aria(page.locator('main')) };
});
await step('listen', 'Change the next song', async () => {
  await page.getByRole('button', { name: 'Change the next song' }).click(); await page.waitForTimeout(1000); await shot('listen-steer');
  return { coming: await aria(page.getByRole('complementary', { name: 'Coming up' })) };
});
await step('listen', 'lyrics', async () => {
  await page.getByRole('button', { name: 'Read all lyrics' }).click(); await page.waitForTimeout(800);
  return { note: 'Read all lyrics opened' };
});
await step('listen', 'Next song skips straight on', async () => {
  const before = await page.locator('main h1').innerText();
  await page.getByRole('button', { name: 'Next song' }).click(); await page.waitForTimeout(3000);
  return { before, after: await page.locator('main h1').innerText() };
});
await step('listen', 'pause', async () => { await page.getByRole('button', { name: 'Pause', exact: true }).first().click(); return {}; });

// My Mixes: save a copy as a draft, render line
await step('my-mixes', 'save current mix as a draft', async () => {
  await page.goto(base + '/mixes/mine'); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Save current mix as a draft' }).click(); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'New draft' }).click(); await page.waitForTimeout(2000);
  await page.goto(base + '/mixes/mine'); await page.waitForTimeout(2000); await shot('my-mixes');
  return { aria: await aria(page.locator('main')) };
});
await step('my-mixes', 'open the first draft editor', async () => {
  const edit = page.getByRole('region', { name: 'Your drafts' }).getByRole('button', { name: /^Edit|^Open/ }).first();
  await edit.click(); await page.waitForTimeout(2500); await shot('draft-editor');
  return { url: page.url(), header: await text(page.getByRole('group', { name: 'What you’re editing' })) };
});

// editor: transition Change panel
await step('editor', 'open the current mix editor, first transition Change', async () => {
  await page.goto(base + '/mix/current/edit'); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Change', exact: true }).first().click(); await page.waitForTimeout(1500); await shot('editor-change');
  const panel = page.getByRole('dialog').first();
  return { panel: (await panel.count()) ? await aria(panel) : await aria(page.locator('main')) };
});
await page.keyboard.press('Escape');

// palette
await step('palette', 'Ctrl+K, type Library, Enter', async () => {
  await page.goto(base + '/listen'); await page.waitForTimeout(1500);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(600);
  await page.keyboard.type('Library'); await page.waitForTimeout(400); await shot('palette');
  await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  return { url: page.url() };
});
await step('palette', 'Keyboard shortcuts button', async () => {
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click(); await page.waitForTimeout(800);
  const d = page.getByRole('dialog').first(); const r = { dialog: (await d.count()) ? (await text(d)).slice(0, 600) : 'none' };
  await page.keyboard.press('Escape'); return r;
});

// Library filters (filter-default study)
await step('library', 'filters and counts', async () => {
  await page.goto(base + '/library'); await page.waitForTimeout(2000);
  const res = {};
  for (const f of ['Everything', 'Ready', 'Not analysed yet', 'Needs attention', 'Priority list', 'Set aside']) {
    await page.getByRole('group', { name: 'Filter Library recordings' }).getByRole('button', { name: f }).click(); await page.waitForTimeout(700);
    res[f] = (await page.getByRole('status').first().innerText()).trim();
  }
  await page.getByRole('group', { name: 'Filter Library recordings' }).getByRole('button', { name: 'Everything' }).click();
  return res;
});
await step('library', 'open a song inspector (tempo)', async () => {
  await page.getByRole('button', { name: 'Details for Paper Moon' }).click(); await page.waitForTimeout(1500); await shot('library-inspector');
  const d = page.getByRole('dialog').or(page.getByRole('complementary')).first();
  return { inspector: (await d.count()) ? (await text(d)).slice(0, 900) : 'none' };
});

// requests drawer
await step('requests', 'open Request a song, search', async () => {
  await page.keyboard.press('Escape');
  await page.goto(base + '/listen'); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Request a song/ }).first().click(); await page.waitForTimeout(1000);
  const box = page.getByRole('combobox', { name: /Request a song/ });
  await box.fill('Last'); await page.waitForTimeout(1500); await shot('requests');
  const d = page.getByRole('dialog').first();
  return { drawer: (await d.count()) ? (await aria(d)) : 'none' };
});

fs.writeFileSync(`${out}/pilot1.json`, JSON.stringify(log, null, 1));
await b.close();
console.log('ok');
