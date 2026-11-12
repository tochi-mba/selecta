import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';

const OUT = 'C:/Users/tochi/AppData/Local/Temp/claude/3ec60e2294e4cf87/30c7424d-04ce-46d7-abd9-1ca76811fedf/scratchpad/ve/out';
const facts: Record<string, unknown> = {};

/** A real OS keystroke (SendInput), which NVDA hears; Playwright's keys go straight to the page. */
function osKeys(keys: string) {
  execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')`], { windowsHide: true });
}

async function mark(page: Page, name: string) {
  await page.evaluate((text) => {
    let region = document.getElementById('ve-mark');
    if (!region) {
      region = document.createElement('div');
      region.id = 've-mark';
      region.setAttribute('aria-live', 'assertive');
      region.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(region);
    }
    region.textContent = `Checkpoint ${text}`;
  }, name);
  await page.waitForTimeout(1800);
}

async function tabs(page: Page, count: number, wait = 700) {
  const seen: string[] = [];
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(wait);
    seen.push(await page.evaluate(() => {
      const n = document.activeElement as HTMLElement;
      return `${n.tagName.toLowerCase()}${n.getAttribute('role') ? `[${n.getAttribute('role')}]` : ''} ${(n.getAttribute('aria-label') ?? n.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)} @${n.closest('nav, .mini-player, .player, [role="dialog"], main, header')?.tagName.toLowerCase() ?? '?'}.${n.closest('nav, .mini-player, .player, [role="dialog"], main, header')?.className.toString().split(' ')[0] ?? ''}`;
    }));
  }
  return seen;
}

async function key(page: Page, keys: string[], wait = 800) {
  for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(wait); }
}

test('NVDA session: headings, names, patterns, live regions, Sheet tab reach', async ({ page, request }) => {
  await page.bringToFront();
  await page.goto('/mixes');
  await page.evaluate(() => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: 'dark', motion: 'still' })));

  // 1. Library: heading navigation in browse mode, then the awkward names
  await page.goto('/library');
  await expect(page.locator('main#main h1, main#main h2').first()).toBeVisible();
  await page.waitForTimeout(4000);
  await mark(page, 'library headings');
  await page.locator('main#main').evaluate((m) => { (m as HTMLElement).tabIndex = -1; (m as HTMLElement).focus(); });
  await page.waitForTimeout(800);
  for (let i = 0; i < 6; i += 1) { osKeys('h'); await page.waitForTimeout(900); }
  await mark(page, 'library landmarks');
  for (let i = 0; i < 5; i += 1) { osKeys('d'); await page.waitForTimeout(900); }
  for (const q of ['Same Name', '夜明け', 'أغنية', 'Remix', 'Hyperextended']) {
    await page.goto(`/library?q=${encodeURIComponent(q)}`);
    await page.waitForTimeout(2500);
    await mark(page, `library search ${q.length} chars`);
    facts[`library ${q}`] = await tabs(page, 14, 500);
  }
  // unknown title and artist: the untagged song
  await page.goto('/library?q=song-15');
  await page.waitForTimeout(2500);
  await mark(page, 'untagged song');
  facts['library untagged'] = await tabs(page, 14, 500);

  // 2. Editor rows, menu, inspector tabs and focus return
  await page.goto('/mix/current/edit');
  await page.waitForTimeout(3000);
  await mark(page, 'editor menu');
  const more = page.getByRole('button', { name: /^More for / }).first();
  await more.focus();
  await page.waitForTimeout(800);
  await key(page, ['Enter', 'ArrowDown', 'ArrowDown', 'End', 'Home', 'Escape']);
  facts.menuReturn = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? (document.activeElement as HTMLElement)?.innerText);
  await mark(page, 'inspector tabs');
  const change = page.getByRole('button', { name: 'Change', exact: true }).first();
  await change.focus();
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.getByRole('tab').first().focus();
  await page.waitForTimeout(800);
  await key(page, ['ArrowRight', 'ArrowRight', 'End', 'Home']);
  facts.inspectorTabs = await page.getByRole('tab').allInnerTexts();
  await mark(page, 'inspector close');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  facts.inspectorReturn = await page.evaluate(() => (document.activeElement as HTMLElement)?.innerText);

  // 3. Download dialog
  await mark(page, 'download dialog');
  await page.getByRole('button', { name: 'Download audio' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  facts.dialogTabs = await tabs(page, 8, 600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);

  // 4. Studio grid
  await mark(page, 'studio grid');
  await change.click();
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click().catch(() => undefined);
  await page.waitForTimeout(1000);
  await page.getByRole('grid').first().locator('[tabindex="0"]').first().focus();
  await page.waitForTimeout(1000);
  await key(page, ['ArrowRight', 'ArrowDown', 'Space', 'Space', 'End', 'Home'], 1000);
  await mark(page, 'studio solo');
  const solo = page.getByRole('button', { name: /^Hear only / }).first();
  await solo.focus();
  await page.waitForTimeout(800);
  await key(page, ['Space', 'Space'], 1000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // 5. Command palette combobox
  await page.goto('/library');
  await page.waitForTimeout(2500);
  await mark(page, 'palette');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(1500);
  await page.keyboard.type('lib', { delay: 150 });
  await page.waitForTimeout(1200);
  await key(page, ['ArrowDown', 'ArrowDown', 'ArrowUp', 'Escape'], 1000);

  // 6. A large draft list
  for (let i = 0; i < 30; i += 1) await request.post('/api/drafts', { data: { name: i % 3 === 0 ? 'Friday night' : i % 3 === 1 ? `A very long draft name that keeps on going past the edge ${i}` : `Draft ${i}`, copy_current: true } });
  await page.goto('/mixes/mine');
  await page.waitForTimeout(3000);
  await mark(page, 'drafts');
  facts.drafts = await tabs(page, 30, 450);

  // 7. Harmonic discovery imagery in browse mode
  await page.goto('/discover/harmonic');
  await page.waitForTimeout(3500);
  await mark(page, 'harmonic graphics');
  await page.locator('main#main').evaluate((m) => { (m as HTMLElement).tabIndex = -1; (m as HTMLElement).focus(); });
  for (let i = 0; i < 4; i += 1) { osKeys('g'); await page.waitForTimeout(1000); }
  facts.harmonicTabs = await tabs(page, 12, 500);

  // 8. Requests drawer and the inspector Sheet at phone width: does Tab reach the tab bar and mini-player?
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/listen');
  await page.waitForTimeout(2500);
  await page.locator('.now .transport .primary').click();
  await page.waitForTimeout(2000);
  await page.locator('.now .transport .primary').click();
  await page.goto('/mix/current/edit');
  await page.waitForTimeout(2500);
  await mark(page, 'phone sheet');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.waitForTimeout(1500);
  facts.sheet = { modal: await page.locator('[aria-modal="true"]').count(), stops: await tabs(page, 40, 350) };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.goto('/listen');
  await page.waitForTimeout(2500);
  await mark(page, 'requests drawer');
  await page.getByRole('button', { name: /^Requests/ }).first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  facts.requests = await tabs(page, 10, 600);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });

  // 9. Live regions: playback plus a background render, then a Lucy reply streaming
  await mark(page, 'playing and rendering');
  await page.locator('.now .transport .primary').click();
  await request.post('/api/mix/songs', { data: { song_id: 2 } });
  await request.post('/api/mix/render');
  await page.waitForTimeout(20_000);
  await page.locator('.now .transport .primary').click();
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'NVDA stream' } })).json();
  await page.goto(`/mixes/lucy/${made.id}`);
  await page.waitForTimeout(3000);
  await mark(page, 'lucy stream');
  const prompt = page.getByRole('textbox', { name: 'Message to Lucy' });
  await prompt.focus();
  await page.keyboard.type('make me a calm mix of 10 songs', { delay: 30 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(25_000);
  await mark(page, 'end');
  writeFileSync(`${OUT}/nvda-facts.json`, JSON.stringify(facts, null, 2));
});
