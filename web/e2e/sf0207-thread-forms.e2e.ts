import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetMix, stickingOut } from './helpers';
import { assertNoPersonalData, provenance } from './pairedEvidence';

/**
 * Flow SF-0207-05: the Thread's compact and expanded forms (player, mix card, editor row and
 * inspector) captured at 320, 768, 1440 and 2560 wide for a person to review side by side. The unit
 * proof that the forms share one grammar is web/src/ui/sf0207CompactExpanded.test.tsx; this checks
 * the same in the real page at every width and keeps the fixtures. Made-up library only.
 */
const OUT = '../docs/verification/claude-checks/flow/thread-forms';
const WIDTHS = [320, 768, 1440, 2560] as const;
const MAX_BYTES = 300 * 1024;

async function keep(target: Locator | Page, name: string, files: string[]) {
  const buffer = await target.screenshot({ animations: 'disabled', caret: 'hide' });
  expect.soft(buffer.length, `${name} is over 300 KB`).toBeLessThanOrEqual(MAX_BYTES);
  writeFileSync(`${OUT}/${name}.png`, buffer);
  files.push(`${name}.png`);
}

test.beforeEach(async ({ request }) => resetMix(request));

for (const width of WIDTHS) {
  test(`SF-0207-05 Thread forms keep one grammar at ${width}px`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const files: string[] = [];

    // Player: the expanded song mark beside the title
    await page.goto('/listen');
    const title = page.locator('.listen-identity .track-title');
    await expect(title.locator('svg.song-motif.large')).toBeVisible();
    expect(await stickingOut(page, `listen at ${width}px`)).toEqual([]);
    await keep(page.locator('.listen-identity'), `${width}-player`, files);

    // Card: the current mix's signature on My Mixes
    await page.goto('/mixes/mine');
    const card = page.getByRole('region', { name: 'Current mix' });
    await expect(card.locator('svg.mix-signature')).toBeVisible();
    expect(await stickingOut(page, `my mixes at ${width}px`)).toEqual([]);
    await keep(card, `${width}-card`, files);

    // Editor row: the compact song mark and the compact seam
    await page.goto('/mix/current/edit');
    const compact = page.locator('.music-seam-diagram.compact').first();
    await expect(compact).toBeVisible();
    const row = compact.locator('xpath=ancestor::li[1]');
    await expect(page.locator('svg.song-motif:not(.large)').first()).toBeVisible();
    expect(await stickingOut(page, `editor at ${width}px`)).toEqual([]);
    await keep(row, `${width}-editor-row`, files);
    const rowMeaning = await compact.getAttribute('aria-label');
    const rowState = await compact.getAttribute('data-state');
    const rowFamily = await compact.getAttribute('data-family');
    const rowWords = await compact.locator('.music-seam-label').textContent();

    // Editor inspector: the same seam, expanded, says exactly the same thing
    await page.getByRole('button', { name: 'Change', exact: true }).first().click();
    const full = page.locator('.inspector .music-seam-diagram:not(.compact)').first();
    await expect(full).toBeVisible();
    await expect(full).toHaveAttribute('aria-label', rowMeaning!);
    await expect(full).toHaveAttribute('data-state', rowState!);
    await expect(full).toHaveAttribute('data-family', rowFamily!);
    await expect(full.locator('.music-seam-label')).toHaveText(rowWords!);
    const lines = async (diagram: Locator) => diagram.locator('.music-seam-lines > i').evaluateAll((marks) => marks.map((mark) => mark.className));
    expect(await lines(full)).toEqual(await lines(compact));
    expect(await stickingOut(page, `inspector at ${width}px`)).toEqual([]);
    await keep(page.locator('.inspector').first(), `${width}-editor-inspector`, files);
    await keep(page, `${width}-editor-page`, files);

    const manifest = JSON.stringify({
      task: 'SF-0207-05', status: 'candidate-not-independently-verified', ...provenance(),
      capturedAt: new Date().toISOString(), browser: 'msedge', width, height: 900,
      fixture: 'tests/e2e_server.py', seam: { meaning: rowMeaning, state: rowState, family: rowFamily }, files,
    }, null, 2);
    assertNoPersonalData(manifest);
    writeFileSync(`${OUT}/manifest-${width}.json`, manifest);
  });
}
