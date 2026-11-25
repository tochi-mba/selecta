import { APIRequestContext, expect, Locator, Page, test } from '@playwright/test';
import { accessible, listener } from './cloud';
import { slowPhone } from './helpers';
import { asLocalFirst, seeded } from './localFirst';

// ADR-0483 and ADR-0484: Lucy's session and week allowance, in a browser against the real Cloud
// API. A scripted model answers each message at once (tests/e2e_cloud_lucy.py), so a turn really
// is admitted, charged and settled. A person is put on the allowance the way production does it:
// a workspace rule on `lucy.usage_windows` and a cutover time that has passed
// (`POST /test/lucy-usage`). Everyone else keeps the turns meter.
//
// Lucy's page lives in the local-first shell, so each person opens it through localFirst.ts.

// wide enough for the conversation list to be a column, where the level meter sits beside New
test.use({ viewport: { width: 1440, height: 900 } });

const REPLY = 'Here is a short answer from the test Lucy.';
/** Lucy's own words when the week is used up (cloud_agent.builtin_words). */
const WEEK_SPENT = /used all of Lucy.s allowance for this week/;
/** What the usage UI never shows (ADR-0484 rule 4): turn counts, tokens, money or a model's name. */
const NEVER = /turns? |token|\$|Sonnet|Opus|Haiku|Claude/i;

type Setup = { grant?: boolean; cutover?: 'past' | 'none'; plan?: 'free' | 'premium'; spend?: { session?: boolean; week?: boolean }; used?: { session?: number; week?: number } };

async function lucyUsage(request: APIRequestContext, user: string, setup: Setup) {
  const answer = await request.post('/test/lucy-usage', { data: { user, ...setup } });
  expect(answer.ok(), await answer.text()).toBeTruthy();
  return (await answer.json()) as { mode: string; plan: string };
}

/** A new person with two catalogue songs, on the new allowance unless `setup` says otherwise. */
async function person(request: APIRequestContext, name: string, setup: Setup = { grant: true, cutover: 'past' }) {
  const user = listener(name);
  await seeded(request, user, { local_songs: 2 });
  const made = await lucyUsage(request, user, setup);
  expect(made.mode).toBe(setup.grant ? 'enforced' : 'shadow');
  return user;
}

async function openLucy(page: Page, user: string, timeout = 20_000) {
  await asLocalFirst(page, user);
  await page.goto('/mixes/lucy', { timeout: Math.max(timeout, 30_000) });
  await expect(page.getByRole('heading', { name: 'Lucy', level: 1 })).toBeVisible({ timeout });
  // her settings have been read: the page is past its first paint
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
}

const levels = (page: Page) => page.getByRole('button', { name: /^Lucy usage: / });
const levelsLabel = (page: Page) => page.locator('.lucy-levels-panel');
const ladder = (page: Page, kind: 'session' | 'week') => page.locator(`.lucy-levels .lucy-ladder[data-kind="${kind}"]`);
const messages = (page: Page) => page.getByRole('log', { name: 'Messages' });
const nextStep = (page: Page) => page.getByRole('complementary', { name: 'What you can do next' });

async function say(page: Page, words: string) {
  const box = page.getByRole('textbox', { name: 'Message to Lucy' });
  await box.fill(words);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(messages(page).getByText(words, { exact: true })).toBeVisible();
}

/** The two-bar meter: both lines, each a bar of what is left, and nothing it must never show. */
async function twoBars(meter: Locator) {
  await expect(meter.locator('.lucy-usage-words b')).toHaveText(['This session', 'This week']);
  await expect(meter.locator('.lucy-usage-figure')).toHaveText([/^\d+% left/, /^\d+% left · back /]);
  await expect(meter.getByRole('meter', { name: 'This session' })).toHaveAttribute('aria-valuetext', /% left/);
  await expect(meter.getByRole('meter', { name: 'This week' })).toHaveAttribute('aria-valuetext', /% left, back /);
  expect(await meter.innerText()).not.toMatch(NEVER);
}

test('with the allowance off, Lucy’s page has no level meter and her settings keep the turns meter', async ({ page, request }) => {
  const user = await person(request, 'lucy-turns', {});
  await openLucy(page, user);
  await expect(page.locator('.lucy-levels')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Lucy settings' });
  await expect(settings.getByText('0 of 40 turns this month', { exact: true }).first()).toBeVisible();
  await expect(settings.getByRole('meter', { name: 'Lucy turns this month' })).toBeVisible();
  await expect(settings.locator('.lucy-usage')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/account/billing');
  await expect(page.getByRole('region', { name: 'Lucy turns this month' })).toContainText('0 of 40 turns');
  await expect(page.getByRole('region', { name: 'Lucy usage' })).toHaveCount(0);
});

test('on the new allowance the twin level meter and the two-bar meter show what is left, everywhere', async ({ page, request }) => {
  const user = await person(request, 'lucy-levels');
  await openLucy(page, user);

  // both figures are in the meter's name, so nobody has to open it to learn them
  const meter = levels(page);
  await expect(meter).toHaveAccessibleName('Lucy usage: 100% left this session, 100% left this week');
  await expect(meter).toHaveAttribute('aria-expanded', 'false');
  // beside New, in the conversation list's own column
  await expect(page.getByRole('navigation', { name: 'Conversations with Lucy' }).getByRole('button', { name: /^Lucy usage: / })).toBeVisible();
  await expect(ladder(page, 'session').locator('[data-lit]')).toHaveCount(5);
  await expect(ladder(page, 'week').locator('[data-lit]')).toHaveCount(5);

  // a click opens the label with both lines; Escape closes it and the meter keeps the focus
  await meter.click();
  const label = levelsLabel(page);
  await expect(label).toBeVisible();
  await expect(label.getByText(/^This session: 100% left/)).toBeVisible();
  await expect(label.getByText(/^This week: 100% left, back /)).toBeVisible();
  expect(await label.innerText()).not.toMatch(NEVER);
  await page.keyboard.press('Escape');
  await expect(label).toBeHidden();
  await expect(meter).toBeFocused();
  await expect(meter).toHaveAttribute('aria-expanded', 'false');

  // the keyboard: reaching it opens the label, Enter keeps it open, Escape hands the focus back
  await page.getByRole('textbox', { name: 'Message to Lucy' }).focus();
  await meter.focus();
  await expect(label).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(label.getByText(/^This week: 100% left/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(label).toBeHidden();
  await expect(meter).toBeFocused();

  // the label's link opens the full meter in Lucy's settings, never a plan page
  await page.keyboard.press('Enter');
  await label.getByRole('button', { name: 'See the full meter in Lucy’s settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Lucy settings' });
  await twoBars(settings.locator('.lucy-usage'));
  await expect(settings.getByText(/turns this month/)).toHaveCount(0);
  await expect(page).toHaveURL(/\/mixes\/lucy/);
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await accessible(page, 'Lucy');

  // the account's settings page and Plan & billing draw the same two lines
  await page.goto('/account');
  const card = page.getByRole('region', { name: 'Lucy on your plan' });
  await twoBars(card.locator('.lucy-usage'));
  await expect(card.getByText(/turns this month/)).toHaveCount(0);
  await accessible(page, 'account');
  await page.goto('/account/billing');
  const billing = page.getByRole('region', { name: 'Lucy usage' });
  await twoBars(billing);
  await expect(page.getByRole('region', { name: 'Lucy turns this month' })).toHaveCount(0);
});

test('a message is answered and the level meter drops without a reload', async ({ page, request }) => {
  const user = await person(request, 'lucy-send');
  await openLucy(page, user);
  await expect(levels(page)).toHaveAccessibleName(/100% left this week$/);
  let loads = 0;
  page.on('load', () => { loads += 1; });
  await say(page, 'What can you do with my library?');
  await expect(messages(page).getByText(REPLY, { exact: true })).toBeVisible();
  // the server says `lucy.usage` when the turn settles, and the meter reads its figures again
  await expect(levels(page)).toHaveAccessibleName(/^Lucy usage: [1-9]?\d% left this session, [1-9]?\d% left this week$/);
  expect(loads).toBe(0);
  await expect(nextStep(page)).toHaveCount(0);
});

test('with the week used up, Lucy answers in her own words with one next step', async ({ page, request }) => {
  const user = await person(request, 'lucy-week', { grant: true, cutover: 'past', spend: { week: true } });
  await openLucy(page, user);
  await expect(levels(page)).toHaveAccessibleName(/, 0% left this week$/);
  await expect(ladder(page, 'week')).toHaveAttribute('data-state', 'spent');
  await expect(ladder(page, 'week').locator('[data-lit]')).toHaveCount(0);
  await levels(page).click();
  await expect(levelsLabel(page).getByText(/^This week: 0% left, back .* · Used up$/)).toBeVisible();
  await page.keyboard.press('Escape');

  await say(page, 'Play something by Rema');
  await expect(messages(page).getByText(WEEK_SPENT)).toBeVisible();
  await expect(messages(page).getByText(REPLY, { exact: true })).toHaveCount(0);
  const step = nextStep(page);
  await expect(step).toHaveCount(1);
  await expect(step.getByRole('listitem').filter({ hasText: /^Lucy is back / })).toBeVisible();
  await expect(step.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', /\/account\/billing$/);
  await expect(step.getByRole('button', { name: 'Use extra usage' })).toHaveCount(0);

  // the same limit met again says its words again, and offers the step only the once
  await say(page, 'And one more');
  await expect(messages(page).getByText(WEEK_SPENT)).toHaveCount(2);
  await expect(step).toHaveCount(1);
  await accessible(page, 'Lucy at the limit');
});

test('on Premium with the session used up, a lighter Lucy answers and says so once', async ({ page, request }) => {
  const user = await person(request, 'lucy-lighter', { plan: 'premium', grant: true, cutover: 'past', spend: { session: true } });
  await openLucy(page, user);
  await expect(ladder(page, 'session')).toHaveAttribute('data-state', 'spent');
  await say(page, 'Play something by Rema');
  await expect(messages(page).getByText(REPLY, { exact: true })).toHaveCount(1);
  const notice = messages(page).getByText(/^A lighter Lucy is answering until this session ends at \d\d:\d\d\.$/);
  await expect(notice).toHaveCount(1);
  await say(page, 'And another');
  await expect(messages(page).getByText(REPLY, { exact: true })).toHaveCount(2);
  await expect(notice).toHaveCount(1);
  await expect(nextStep(page)).toHaveCount(0);
  // the week pays for a lighter turn, and the session stays spent
  await expect(levels(page)).toHaveAccessibleName(/^Lucy usage: 0% left this session, \d\d% left this week$/);
  // read again from the server, the conversation still says it, and still once
  await page.reload();
  await expect(messages(page).getByText(REPLY, { exact: true })).toHaveCount(2);
  await expect(notice).toHaveCount(1);
  await expect(nextStep(page)).toHaveCount(0);
});

test('on a phone, a tap opens the level meter’s label and a second tap closes it', async ({ browser, request }) => {
  test.slow();
  const user = await person(request, 'lucy-phone', { grant: true, cutover: 'past', used: { session: 40, week: 85 } });
  const { context, page } = await slowPhone(browser);
  try {
    // a weak connection: the app itself takes a while to arrive
    await openLucy(page, user, 90_000);
    // the conversation list is not a column here, so the pair sits in Lucy's header
    const meter = page.locator('.lucy-head').getByRole('button', { name: /^Lucy usage: / });
    await expect(meter).toHaveAccessibleName('Lucy usage: 60% left this session, 15% left this week');
    await expect(ladder(page, 'week')).toHaveAttribute('data-state', 'near');
    const box = await meter.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await meter.tap();
    const label = levelsLabel(page);
    await expect(label.getByText(/^This session: 60% left, back /)).toBeVisible();
    await expect(label.getByText(/^This week: 15% left, back .* · Nearly used up$/)).toBeVisible();
    // the label stays on the screen: nothing sticks out sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const shown = await label.boundingBox();
    expect(shown!.x).toBeGreaterThanOrEqual(0);
    expect(shown!.x + shown!.width).toBeLessThanOrEqual(320);
    await meter.tap();
    await expect(label).toBeHidden();
    await expect(meter).toHaveAttribute('aria-expanded', 'false');
    // and a tap elsewhere closes it too
    await meter.tap();
    await expect(label).toBeVisible();
    await page.getByRole('heading', { name: 'Lucy', level: 1 }).tap();
    await expect(label).toBeHidden();
  } finally {
    await context.close();
  }
});
