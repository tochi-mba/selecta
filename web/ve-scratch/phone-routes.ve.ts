import { expect, test } from '@playwright/test';
import { covered, horizontalOverflow, out, ROUTES, save, setTheme, settle } from './lib';

const names = (page: import('@playwright/test').Page) => page.locator('main#main').evaluate((main) => {
  const actions = [...main.querySelectorAll('button, a[href], input, select, [role="tab"]')]
    .map((n) => (n.getAttribute('aria-label') ?? (n as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' '))
    .filter((n) => n && !/^\d+(:\d+)?$/.test(n));
  const songs = [...main.querySelectorAll('[class*="title"], .song-title, .track-title')].map((n) => (n as HTMLElement).innerText.trim()).filter(Boolean);
  return { actions: [...new Set(actions)].sort(), songs: [...new Set(songs)].sort() };
});

test('phone: every route in portrait and landscape, touch targets, overflow, occlusion, 200% text', async ({ page }, info) => {
  const project = info.project.name;
  const report: Record<string, unknown> = {};
  const size = page.viewportSize()!;
  for (const orientation of ['portrait', 'landscape'] as const) {
    await page.setViewportSize(orientation === 'portrait' ? size : { width: size.height, height: size.width });
    await setTheme(page, 'dark');
    for (const route of ROUTES) {
      await page.goto(route.path);
      await settle(page);
      const small = await page.locator('main#main').evaluate((main) => [...main.querySelectorAll('button, a[href], input, select, [role="tab"], [role="checkbox"]')]
        .filter((n) => (n as HTMLElement).offsetParent !== null)
        .map((n) => ({ n: (n.getAttribute('aria-label') ?? (n as HTMLElement).innerText ?? '').trim().slice(0, 30), b: n.getBoundingClientRect() }))
        .filter(({ b, n }) => b.width > 0 && (b.width < 24 || b.height < 24) && n)
        .map(({ n, b }) => `${n} ${Math.round(b.width)}x${Math.round(b.height)}`));
      const entry: Record<string, unknown> = { overflow: await horizontalOverflow(page), covered: await covered(page, 'main#main button, main#main a[href], main#main input'), small };
      if (orientation === 'portrait') entry.names = await names(page);
      report[`${orientation} ${route.path}`] = entry;
      await page.screenshot({ path: out('phone', project, `${orientation}-${route.id}.png`) });
    }
  }
  // 200% text size: rem-based type should grow and nothing should spill sideways
  await page.setViewportSize(size);
  for (const route of ROUTES) {
    await page.goto(route.path);
    await settle(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; -webkit-text-size-adjust: 200% !important; }' });
    await page.waitForTimeout(200);
    report[`text200 ${route.path}`] = { overflow: await horizontalOverflow(page), bodyFont: await page.evaluate(() => getComputedStyle(document.querySelector('main#main p, main#main li, main#main span') ?? document.body).fontSize) };
    if (['/listen', '/library', '/mix/current/edit', '/mixes'].includes(route.path)) await page.screenshot({ path: out('phone', project, `text200-${route.id}.png`) });
  }
  save(`phone-${project}.json`, report);
});

test('phone: Lucy composer and approval with an on-screen keyboard inset', async ({ page, request }, info) => {
  const project = info.project.name;
  await page.addInitScript(() => {
    let keyboard = 0;
    const events = new EventTarget();
    const view = {
      get width() { return window.innerWidth; }, get height() { return Math.max(window.innerHeight - keyboard, 0); },
      offsetTop: 0, offsetLeft: 0, scale: 1, onresize: null, onscroll: null,
      get pageTop() { return window.scrollY; }, get pageLeft() { return window.scrollX; },
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => view });
    (window as unknown as { keyboardTo: (h: number) => void }).keyboardTo = (h: number) => { keyboard = h; events.dispatchEvent(new Event('resize')); };
  });
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  const made = await (await request.post('/api/lucy/conversations', { data: { title: `VE ${project}` } })).json();
  await setTheme(page, 'dark');
  await page.goto(`/mixes/lucy/${made.id}`);
  const prompt = page.getByRole('textbox', { name: 'Message to Lucy' });
  await expect(prompt).toBeVisible();
  await prompt.tap();
  await page.evaluate(() => (window as unknown as { keyboardTo: (h: number) => void }).keyboardTo(330));
  const check = (label: string) => page.evaluate((name) => {
    const node = [...document.querySelectorAll('button, textarea, input')].find((n) => (n.getAttribute('aria-label') ?? (n as HTMLElement).innerText).trim().startsWith(name)) as HTMLElement | undefined;
    if (!node) return `${name}: not found`;
    node.scrollIntoView({ block: 'nearest' });
    const box = node.getBoundingClientRect();
    const bottom = window.visualViewport!.height;
    if (box.bottom > bottom + 0.5 || box.top < -0.5) return `${name}: ${Math.round(box.top)}-${Math.round(box.bottom)} vs keyboard at ${Math.round(bottom)}`;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit && (hit === node || node.contains(hit)) ? '' : `${name}: covered by ${hit?.tagName}.${hit?.className}`;
  }, label);
  const r: Record<string, unknown> = { keyboardAttr: await page.locator('html').getAttribute('data-keyboard') };
  r.promptBefore = await check('Message to Lucy');
  await prompt.fill('make me 6 songs');
  r.send = await check('Send');
  await page.screenshot({ path: out('phone', project, 'lucy-keyboard-typing.png') });
  await page.getByRole('button', { name: 'Send' }).tap();
  // Stop while the reply streams
  const stop = page.getByRole('button', { name: /^Stop/ });
  r.stopSeen = await stop.isVisible({ timeout: 3000 }).catch(() => false);
  if (r.stopSeen) { r.stop = await check('Stop'); await page.screenshot({ path: out('phone', project, 'lucy-keyboard-streaming.png') }); }
  await expect(page.getByRole('tab', { name: 'Your mix' })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  await page.getByRole('tab', { name: 'Your mix' }).tap();
  r.saveDraft = await check('Save as draft');
  r.savePlay = await check('Save and play');
  await page.screenshot({ path: out('phone', project, 'lucy-keyboard-approval.png') });
  save(`phone-lucy-${project}.json`, r);
});
