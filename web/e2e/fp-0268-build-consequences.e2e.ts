import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * FP-0268-06: Play, Shape first and Save draft keep their separate consequences in the real app, including
 * when the build fails. A failed build of any of the three leaves the current mix and the saved drafts exactly
 * as they were, keeps the listener on Make a Mix with the reason shown, and frees the card to try again. A
 * successful Save draft adds a draft and leaves the current mix alone; a successful Shape first opens the new
 * mix in the editor.
 */

const currentOrder = async (page: Page) =>
  ((await (await page.request.get('/api/mix')).json()).mix as { song_id: number }[]).map((item) => item.song_id);
const draftIds = async (page: Page) =>
  ((await (await page.request.get('/api/drafts')).json()).drafts as { id: number }[]).map((draft) => draft.id).sort();

async function clickAndConfirm(page: Page, button: Locator, confirm: string) {
  await button.click();
  // a mix that is playing or paused is asked about first; an idle one builds straight away (EX-0117-04)
  const dialog = page.getByRole('dialog');
  const ask = dialog.getByRole('button', { name: confirm });
  if (await ask.isVisible({ timeout: 1500 }).catch(() => false)) await ask.click();
}

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
});

const ACTIONS = [
  { name: 'Play', button: (card: Locator) => card.getByRole('button', { name: 'Play', exact: true }), confirm: 'Replace and play' },
  { name: 'Shape first', button: (card: Locator) => card.getByRole('button', { name: 'Shape first' }), confirm: 'Replace and edit' },
  { name: 'Save draft', button: (card: Locator) => card.getByRole('button', { name: /^Save draft for / }), confirm: '' },
] as const;

for (const action of ACTIONS) {
  test(`a failed ${action.name} build leaves the current mix and the drafts alone and says why (FP-0268-06)`, async ({ page }) => {
    const order = await currentOrder(page);
    await page.goto('/mixes');
    const card = page.locator('article.vibe-card').first();
    await expect(card).toBeVisible();
    const drafts = await draftIds(page);

    let builds = 0;
    await page.route('**/api/vibes/*/build*', async (route) => {
      builds += 1;
      await route.fulfill({ status: 500, json: { detail: 'The test server refused this build.' } });
    });
    await clickAndConfirm(page, action.button(card), action.confirm);

    await expect(page.locator('main [role="alert"]')).toBeVisible();
    expect(builds).toBeGreaterThan(0);
    // nothing moved: still on Make a Mix, the same current mix, the same drafts
    await expect(page).toHaveURL(/\/mixes/);
    expect(await currentOrder(page)).toEqual(order);
    expect(await draftIds(page)).toEqual(drafts);
    // the card is free to try again
    await expect(action.button(card)).toBeEnabled();
    await expect(action.button(card)).not.toHaveAttribute('aria-busy', 'true');
  });
}

test('a saved draft is added without touching the current mix, and Shape first opens the new mix to edit (FP-0268-06)', async ({ page }) => {
  const order = await currentOrder(page);
  await page.goto('/mixes');
  const card = page.locator('article.vibe-card').first();
  await expect(card).toBeVisible();
  const drafts = await draftIds(page);

  await card.getByRole('button', { name: /^Save draft for / }).click();
  await expect.poll(async () => (await draftIds(page)).length).toBe(drafts.length + 1);
  expect(await currentOrder(page)).toEqual(order);
  await expect(page).toHaveURL(/\/mixes/);

  await clickAndConfirm(page, card.getByRole('button', { name: 'Shape first' }), 'Replace and edit');
  await expect(page).toHaveURL(/\/mix\/current\/edit$/);
  await expect.poll(async () => (await currentOrder(page)).join(',')).not.toBe(order.join(','));
  // the draft saved earlier is still there, untouched by the build that replaced the current mix
  const after = await draftIds(page);
  for (const id of drafts) expect(after).toContain(id);
  for (const id of after.filter((id) => !drafts.includes(id))) await page.request.delete(`/api/drafts/${id}`);
});
