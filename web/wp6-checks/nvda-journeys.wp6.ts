// wp6- TEMPORARY headed NVDA session for T0044, T0264 and FP-0270-06. Made-up library only.
// Keyboard input goes through the page; NVDA browse-mode keys (h, d) go through the OS (SendKeys)
// so NVDA's own keyboard hook sees them. Deleted after use.
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { resetMix } from '../e2e/helpers';
import { focused, mark, press, recorder, settle, wakeNvda } from './shared';

const rec = recorder('nvda-journeys');

/** Real OS keystrokes (SendKeys syntax), so NVDA's browse-mode quick keys run. */
function osKeys(keys: string, times = 1) {
  const script = `Add-Type -AssemblyName System.Windows.Forms; for($i=0;$i -lt ${times};$i++){[System.Windows.Forms.SendKeys]::SendWait('${keys}'); Start-Sleep -Milliseconds 1400}`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
}

async function browse(page: Page, keys: string, times: number) {
  // Escape leaves focus mode, so the quick key is NVDA's and not the page's
  osKeys('{ESC}');
  await page.waitForTimeout(800);
  osKeys(keys, times);
  await page.waitForTimeout(1200);
}

test('NVDA journeys: structure, keyboard-only tasks and overlays', async ({ page, request }) => {
  test.setTimeout(900_000);
  await resetMix(request, [1, 2, 3, 4]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/listen');
  await settle(page);
  await wakeNvda(page);

  await rec.step('listen-structure', async () => {
    await mark(page, 'one listen landmarks');
    await browse(page, 'd', 5);
    await mark(page, 'one b listen headings');
    await browse(page, 'h', 6);
  });

  await rec.step('skip-and-tab', async () => {
    await page.goto('/listen'); await settle(page);
    await mark(page, 'two tab order from the top');
    await page.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await press(page, 'Tab', 8, 1500);
    rec.notes.tab8 = await focused(page);
  });

  await rec.step('library-keyboard-task', async () => {
    await page.goto('/library'); await settle(page);
    await mark(page, 'three library headings');
    await browse(page, 'h', 4);
    await mark(page, 'three b search by keyboard');
    await page.getByRole('searchbox').first().focus(); await page.waitForTimeout(1500);
    await page.keyboard.type('Slow', { delay: 150 }); await page.waitForTimeout(5000);
    await mark(page, 'three c add a song by keyboard');
    const more = page.getByRole('button', { name: /^More actions for .*Slow Tide/ }).first();
    await more.focus(); await page.waitForTimeout(1800);
    await press(page, 'Enter', 1, 2500);
    await press(page, 'ArrowDown', 1, 1800);
    await press(page, 'Escape', 1, 2000);
    rec.notes.menuFocusBack = await focused(page);
    await page.getByRole('searchbox').first().fill(''); await page.waitForTimeout(1500);
  });

  await rec.step('listen-play-by-keyboard', async () => {
    await page.goto('/listen'); await settle(page);
    await mark(page, 'four play by keyboard');
    await page.getByRole('button', { name: /^(Play|Resume from)/ }).focus(); await page.waitForTimeout(1800);
    await press(page, 'Enter', 1, 4000);
    rec.notes.afterPlay = await focused(page);
    await page.getByRole('slider', { name: 'Where in the song' }).focus(); await page.waitForTimeout(1800);
    await press(page, 'ArrowRight', 2, 1800);
    await page.getByRole('button', { name: 'Pause', exact: true }).focus(); await page.waitForTimeout(1500);
    await press(page, 'Enter', 1, 2500);
  });

  await rec.step('drawer', async () => {
    await page.goto('/listen'); await settle(page);
    await mark(page, 'five requests drawer');
    await page.locator('main').first().evaluate((n) => { (n as HTMLElement).tabIndex = -1; (n as HTMLElement).focus(); });
    await press(page, 'r', 1, 3500);
    rec.notes.drawerOpen = await page.getByRole('dialog').count();
    rec.notes.drawerFocus = await focused(page);
    await press(page, 'Tab', 3, 1600);
    rec.notes.drawerTabStaysInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    await press(page, 'Escape', 1, 2500);
    rec.notes.drawerFocusBack = await focused(page);
  });

  await rec.step('toast-then-destructive-dialog', async () => {
    await page.goto('/mix/current/edit'); await settle(page);
    await mark(page, 'six a notice then the clear dialog');
    const down = page.getByRole('button', { name: /^Move .* down/ }).first();
    await down.focus(); await page.waitForTimeout(1500);
    await press(page, 'Enter', 1, 1200);
    const clear = page.getByRole('button', { name: 'Clear', exact: true });
    await clear.focus(); await page.waitForTimeout(1200);
    await press(page, 'Enter', 1, 3500);
    const dialog = page.getByRole('dialog', { name: 'Clear the current mix?' });
    await expect(dialog).toBeVisible();
    rec.notes.dialogFocus = await focused(page);
    // nothing sits over the destructive consent: the centre of each action is the action itself
    rec.notes.actionsUncovered = await dialog.evaluate((box) => [...box.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return `${b.textContent?.trim()}: ${top === b || b.contains(top)}`;
    }));
    rec.notes.toastsVisible = await page.locator('.toast, [class*="toast"]').count();
    await press(page, 'Tab', 5, 1600);
    rec.notes.dialogTabStaysInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    await press(page, 'Escape', 1, 2500);
    rec.notes.dialogFocusBack = await focused(page);
    await expect(page.getByRole('dialog', { name: 'Clear the current mix?' })).toHaveCount(0);
    rec.notes.mixStillHasSongs = (await (await request.get('/api/mix')).json()).mix.length;
  });

  await rec.step('status-messages', async () => {
    await mark(page, 'seven undo notice');
    const undo = page.getByRole('button', { name: 'Undo', exact: true }).first();
    if (await undo.count()) { await undo.focus(); await page.waitForTimeout(1200); await press(page, 'Enter', 1, 3500); }
    rec.notes.afterUndo = await focused(page);
  });

  await mark(page, 'end');
  rec.save();
  expect(rec.errors).toEqual({});
});
