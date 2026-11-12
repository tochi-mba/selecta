import { expect, test, type Page } from '@playwright/test';
import { audioClock, spyOnAudio } from './helpers';
import { browserLine } from './perf-probe';

/**
 * S4-0096-10 (time to first valid play) and S4-0097-10 (time and steps to choose a first mix), timed
 * in Edge against the made-up library from tests/e2e_server.py. This is the automated lab baseline a
 * listener session is compared against: a scripted run that knows where to click. It cannot measure
 * a person's confidence, hesitation or errors, which only an observed session can. Results print as
 * `S4-TTFP {...}` lines and are attached to the test.
 *
 * "Valid play" means the audio clock is really moving and the player says Pause, not merely that a
 * button was pressed.
 */
const BUDGET = {
  // a scripted run on the shared laptop; a person will be slower, which is what the session records
  firstScreenMs: 5_000,
  firstValidPlayMs: 60_000,
  tabsToFirstPlay: 30,
};

async function validPlay(page: Page) {
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await expect.poll(async () => (await audioClock(page))[0] ?? 0, { timeout: 90_000 }).toBeGreaterThan(0.5);
}

const since = (start: number) => Date.now() - start;

test.beforeEach(async ({ page, request }) => {
  await request.post('/api/mix/clear');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await spyOnAudio(page);
});

test('S4-0096-10 time from opening SelectaDJ to the first valid play, with the quick pick', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const start = Date.now();
  await page.goto('/');
  await expect(page.locator('main#main')).toBeVisible();
  const firstScreen = since(start);
  const play = page.locator('.mix-quick').getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled({ timeout: 60_000 });
  const playOffered = since(start);
  await play.click();
  const replace = page.getByRole('dialog').getByRole('button', { name: 'Replace and play' });
  if (await replace.isVisible().catch(() => false)) await replace.click();
  const pressed = since(start);
  await validPlay(page);
  const firstValidPlay = since(start);
  const route = new URL(page.url()).pathname;
  const result = { test: 'S4-0096-10', machine: await browserLine(page), budget: BUDGET, ms: { firstScreen, playOffered, pressed, firstValidPlay }, landedOn: route, clicks: 1 };
  console.log(`S4-TTFP ${JSON.stringify(result)}`);
  await info.attach('s4-0096-10.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(firstScreen).toBeLessThanOrEqual(BUDGET.firstScreenMs);
  expect(firstValidPlay).toBeLessThanOrEqual(BUDGET.firstValidPlayMs);
});

test('S4-0097-10 choosing a first mix from the idea cards: steps, keyboard reach and time to valid play', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const start = Date.now();
  await page.goto('/mixes');
  const cards = page.locator('article.vibe-card');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  const cardsShown = since(start);
  const cardCount = await cards.count();
  // each idea says what it can draw on before anyone presses it, so a choice is informed
  const facts = await cards.evaluateAll((all) => all.map((card) => ({
    title: card.querySelector('h3')?.textContent?.trim() ?? '',
    facts: card.querySelector('.vibe-card-facts')?.textContent?.trim() ?? '',
    play: !!card.querySelector('.card-actions > button'),
  })));

  // keyboard: how many Tab presses from the top of the page to the first card's Play
  await page.locator('body').focus();
  let tabs = 0;
  let reached = false;
  for (; tabs < 60 && !reached; tabs += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const focused = document.activeElement;
      if (!focused?.closest('article.vibe-card')) return false;
      // the label a person hears: Action keeps its "Building…" label in the button, hidden, to hold
      // the width, so the raw textContent reads "PlayBuilding…"
      const heard = focused.cloneNode(true) as Element;
      heard.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
      return /^Play\b/.test((heard.textContent ?? '').trim());
    });
  }
  const chooseStart = Date.now();
  await page.keyboard.press('Enter');
  const replace = page.getByRole('dialog').getByRole('button', { name: 'Replace and play' });
  if (await replace.isVisible().catch(() => false)) await replace.click();
  await validPlay(page);
  const chooseToPlay = since(chooseStart);
  const result = { test: 'S4-0097-10', machine: await browserLine(page), budget: BUDGET, ms: { cardsShown, chooseToPlay, total: since(start) }, cardCount, tabsToFirstPlay: reached ? tabs : null, facts };
  console.log(`S4-TTFP ${JSON.stringify(result)}`);
  await info.attach('s4-0097-10.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(cardCount).toBeGreaterThan(0);
  for (const card of facts) {
    expect(card.title, 'an idea without a name').not.toBe('');
    expect(card.play, `${card.title}: no Play`).toBe(true);
  }
  expect(reached, 'Tab never reached a card Play').toBe(true);
  expect(tabs).toBeLessThanOrEqual(BUDGET.tabsToFirstPlay);
  expect(chooseToPlay).toBeLessThanOrEqual(BUDGET.firstValidPlayMs);
});
