import { APIRequestContext, expect, Locator, Page, test } from '@playwright/test';
import { asStaff, enterConsole, listener, signedIn } from './cloud';

// SC-0414-06: the admin Flags page applying changes, not just previewing them. An Owner switches a
// feature off for one customer (whose open page closes up at once), rolls a flag out to a tier,
// schedules it, proposes switching it off for a whole tier (a broad change, so it waits as a
// dangerous action, ADR-0401 §7.4, and is cancelled), pulls the kill switch (instant, alerting
// every Owner) and rolls back to an earlier version, which is broad again and runs only once a
// second Owner approves it. Every step shows in the flag's history and in the audit log.
//
// These change flags for everyone, so they use `account.labs`, which no page shows yet, and
// `rooms.display` only for this test's own customer; both are cleared afterwards.

const LABS = 'account.labs';
const SCREEN = 'rooms.display';

test.afterEach(async ({ request }) => {
  await request.post('/test/flags/reset', { data: { flags: [LABS, SCREEN] } });
});

type Account = { user: { id: string }; features: Record<string, boolean> };
async function accountOf(request: APIRequestContext, user: string): Promise<Account> {
  return (await request.get('/api/account', { headers: { Authorization: `Bearer e2e:${user}` } })).json();
}

/** A `datetime-local` value, in the browser's (and this machine's) time zone. */
function local(at: Date) {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
}

async function openFlag(page: Page, id: string, label: string): Promise<Locator> {
  await page.getByRole('button', { name: `Open flag ${id}`, exact: true }).click();
  const panel = page.getByRole('region', { name: `${label} (${id})`, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/** Choose an action, preview its impact, then apply it with a reason. The outcome's words. */
async function apply(panel: Locator, action: string, reason: string, fill: (panel: Locator) => Promise<void> = async () => {}, expected?: RegExp) {
  await field(panel, 'Action').selectOption(action);
  await fill(panel);
  await panel.getByRole('button', { name: 'Preview impact' }).click();
  const impact = panel.getByLabel('Impact preview');
  await expect(impact.getByText(/accounts change/)).toBeVisible();
  if (expected) await expect(impact).toContainText(expected);
  await impact.getByRole('button', { name: /^Apply: / }).click();
  await panel.getByLabel(/^Reason for/).fill(reason);
  await panel.getByRole('form', { name: /^Apply: / }).getByRole('button', { name: /^Apply: / }).click();
  const status = panel.getByRole('status');
  await expect(status).toHaveText(/^(Saved as version \d+|This is a broad change)/);
  return (await status.textContent()) ?? '';
}

/** A form control by its label's first words: a label that wraps a select also takes the
 * select's options into its accessible name, so names alone can't pick one. */
const field = (panel: Locator, label: string) => panel.locator('label').filter({ hasText: new RegExp(`^${label}`) }).locator('select, input');

const versionIn = (words: string) => Number(/version (\d+)/.exec(words)?.[1]);

test('an Owner applies each kind of flag change on the Flags page, and each shows in history and the audit log', async ({ browser, page, request }) => {
  test.setTimeout(240_000);
  const tag = Date.now().toString(36);
  const why = (step: string) => `e2e ${tag}: ${step}`;

  // A Premium customer with a room open, watching Listen in their own browser.
  const customer = listener('customer');
  await request.post('/test/seed', { data: { user: customer, plan: 'premium' } });
  const opened = await request.post('/api/rooms', {
    headers: { Authorization: `Bearer e2e:${customer}`, Origin: String(test.info().project.use.baseURL) },
    data: { name: 'Flag party', settings: {} },
  });
  expect(opened.ok(), await opened.text()).toBeTruthy();
  const theirs = await browser.newContext();
  const them = await theirs.newPage();
  await signedIn(them, request, customer, { path: '/listen' });
  await them.evaluate(() => { (window as unknown as { stayed: boolean }).stayed = true; });
  const bigScreen = them.locator('.room-panel').getByRole('heading', { name: 'Big screen' });
  await expect(bigScreen).toBeVisible();
  const customerId = (await accountOf(request, customer)).user.id;

  const owner = await asStaff(page, request);
  const nav = await enterConsole(page);
  await nav.getByRole('button', { name: 'Flags' }).click();

  // Off for these users: one account is a per-workspace override, so it applies at once, and the
  // customer's open page closes up around it over the event stream, with no reload.
  let panel = await openFlag(page, SCREEN, 'Room display');
  const userOff = await apply(panel, 'off_for_users', why('off for one customer'), async (form) => {
    await field(form, 'User ids').fill(customerId);
  });
  expect(userOff).toMatch(/^Saved as version/);
  await expect(bigScreen).toHaveCount(0, { timeout: 10_000 });
  await expect(them.locator('.room-panel')).toBeVisible();
  expect(await them.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
  expect((await accountOf(request, customer)).features[SCREEN]).toBe(false);
  await expect(panel.getByRole('table', { name: 'Rule versions' }).getByRole('row').filter({ hasText: why('off for one customer') })).toContainText('Off for 1 users');

  // Roll out to a share of a tier: all of Premium, which changes nobody, so it applies at once.
  panel = await openFlag(page, LABS, 'Labs');
  const history = panel.getByRole('table', { name: 'Rule versions' });
  const rollout = await apply(panel, 'rollout', why('rollout'), async (form) => {
    await field(form, 'Tier').selectOption('premium');
    await field(form, 'Percent').fill('100');
  });
  expect(rollout).toMatch(/^Saved as version/);
  await expect(history.getByRole('row').filter({ hasText: why('rollout') })).toContainText('100% rollout of premium');

  // Schedule: on from an hour ago until an hour from now, so nobody changes today.
  const now = Date.now();
  const scheduled = await apply(panel, 'schedule', why('schedule'), async (form) => {
    await field(form, 'From').fill(local(new Date(now - 3_600_000)));
    await field(form, 'Until').fill(local(new Date(now + 3_600_000)));
  });
  expect(scheduled).toMatch(/^Saved as version/);
  const scheduleVersion = versionIn(scheduled);
  await expect(history.getByRole('row').filter({ hasText: why('schedule') })).toContainText(/On from .* until /);

  // Off for a whole tier is broad: it waits as a dangerous action, and nothing changes yet.
  const rows = await history.getByRole('row').count();
  const tier = await apply(panel, 'off_for_tier', why('tier off'), async (form) => {
    await field(form, 'Tier').selectOption('free');
  }, /wait 15 minutes/);
  expect(tier).toMatch(/^This is a broad change, so it waits: it runs after .+ unless cancelled \(action [0-9a-f]{8}\)\.$/);
  await expect(history.getByRole('row')).toHaveCount(rows);
  expect((await accountOf(request, customer)).features[LABS]).toBe(true);

  // Off for everyone: the kill switch is instant, and alerts every Owner.
  const killed = await apply(panel, 'kill_switch', why('kill switch'), async () => {}, /A kill switch is instant and alerts every Owner/);
  expect(killed).toMatch(/^Saved as version/);
  await expect(history.getByRole('row').filter({ hasText: why('kill switch') })).toContainText('Off for everyone');
  expect((await accountOf(request, customer)).features[LABS]).toBe(false);
  const labs = await request.get('/api/account/labs', { headers: { Authorization: `Bearer e2e:${customer}` } });
  expect(labs.status()).toBe(403);
  expect((await labs.json()).detail.code).toBe('flag_off');

  // Rollback: restoring the schedule's version lifts the kill switch for everyone, which is
  // broad too, so it waits for a second Owner.
  await history.getByRole('button', { name: `Restore version ${scheduleVersion}` }).click();
  await panel.getByLabel(/^Reason for/).fill(why('rollback'));
  await panel.getByRole('form', { name: `Restore version ${scheduleVersion}` }).getByRole('button', { name: `Restore version ${scheduleVersion}` }).click();
  await expect(panel.getByRole('status')).toHaveText(/^The rollback is broad, so it waits until /);
  expect((await accountOf(request, customer)).features[LABS]).toBe(false);

  // The kill switch's alert is on the Overview.
  await nav.getByRole('button', { name: 'Overview' }).click();
  await expect(page.getByRole('table', { name: 'Recent alerts' }).getByText(`Kill switch on ${LABS}: ${why('kill switch')}`)).toBeVisible();

  // Both broad changes wait on the Security page. The tier switch-off is cancelled.
  await nav.getByRole('button', { name: 'Security' }).click();
  const waiting = page.getByRole('table', { name: 'Dangerous actions' });
  const tierRow = waiting.getByRole('row').filter({ hasText: why('tier off') });
  await expect(tierRow).toBeVisible();
  await tierRow.getByRole('button', { name: 'Cancel' }).click();
  await tierRow.getByLabel(/^Reason for/).fill(why('cancel tier off'));
  await tierRow.getByRole('form', { name: 'Cancel' }).locator('button[type="submit"], button:not([type])').first().click();
  await expect(page.getByRole('status').filter({ hasText: 'cancel: done.' })).toBeVisible();
  await expect(waiting.getByRole('row').filter({ hasText: why('tier off') })).toHaveCount(0);
  // The Owner can't approve their own rollback.
  const rollbackRow = waiting.getByRole('row').filter({ hasText: why('rollback') });
  await expect(rollbackRow).toBeVisible();
  await expect(rollbackRow.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // A second Owner approves the rollback and runs it: the feature is back for the customer.
  const second = await browser.newContext();
  const approver = await second.newPage();
  await asStaff(approver, request);
  const theirNav = await enterConsole(approver);
  await theirNav.getByRole('button', { name: 'Security' }).click();
  const toApprove = approver.getByRole('table', { name: 'Dangerous actions' }).getByRole('row').filter({ hasText: why('rollback') });
  await toApprove.getByRole('button', { name: 'Approve' }).click();
  await expect(approver.getByRole('status').filter({ hasText: 'approve: done.' })).toBeVisible();
  await toApprove.getByRole('button', { name: 'Run now if due' }).click();
  await expect(approver.getByRole('status').filter({ hasText: 'execute: done.' })).toBeVisible();
  await expect.poll(async () => (await accountOf(request, customer)).features[LABS], { timeout: 10_000 }).toBe(true);
  await second.close();

  // History: the rollback is a new version restoring the schedule and the rollout.
  await nav.getByRole('button', { name: 'Flags' }).click();
  panel = await openFlag(page, LABS, 'Labs');
  const restored = panel.getByRole('table', { name: 'Rule versions' }).getByRole('row').filter({ hasText: `rollback to version ${scheduleVersion}: ${why('rollback')}` });
  await expect(restored).toBeVisible();
  await expect(restored).not.toContainText('Off for everyone');
  await expect(restored).toContainText('100% rollout of premium');

  // The audit log has every change, with its reason, including the cancelled one.
  await nav.getByRole('button', { name: 'Security' }).click();
  await page.getByLabel('Action starts with').fill('flags.rules');
  await page.getByRole('form', { name: 'Audit search' }).getByRole('button', { name: 'Search' }).click();
  const audit = page.getByRole('table', { name: 'Audit events' });
  for (const step of ['off for one customer', 'rollout', 'schedule', 'tier off', 'kill switch']) {
    await expect(audit.getByRole('row').filter({ hasText: why(step) }).first()).toBeVisible();
  }
  await expect(audit.getByRole('row').filter({ hasText: `rollback to version ${scheduleVersion}: ${why('rollback')}` }).first()).toBeVisible();
  await page.getByLabel('Action starts with').fill('dangerous_action');
  await page.getByRole('form', { name: 'Audit search' }).getByRole('button', { name: 'Search' }).click();
  await expect(audit.getByRole('row').filter({ hasText: why('cancel tier off') }).first()).toBeVisible();
  expect(owner).toBeTruthy();
  await theirs.close();
});
