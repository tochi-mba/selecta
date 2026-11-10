import { expect, test } from '@playwright/test';
import { accessible, asStaff, enterConsole as enter, listener, signedIn } from './cloud';

// The staff console's six pages (§7.5) against the real Cloud API: an Owner enters an admin
// session and walks through each page. Nothing here changes shared state another test could
// notice (no emergency control, no flag rule is applied): changes are previewed, not saved.

test('a customer never sees the staff console', async ({ page, request }) => {
  await signedIn(page, request, listener('customer'));
  await expect(page.getByRole('button', { name: 'Staff console' })).toHaveCount(0);
});

test('an Owner walks through the six admin pages', async ({ page, request }) => {
  const customer = listener('listener');
  await request.post('/test/seed', { data: { user: customer, songs: 1, seconds: 4 } });
  await asStaff(page, request);
  const nav = await enter(page);
  await expect(nav.getByRole('button')).toHaveText(['Overview', 'Jobs & workers', 'Accounts & billing', 'AI routing', 'Security', 'Flags']);

  // Overview: every number with its freshness, alerts, and the emergency controls.
  await expect(page.getByRole('region', { name: 'Service health', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Service health', exact: true }).getByText('health.postgres')).toBeVisible();
  await expect(page.getByText('Aggregates refreshed:')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Emergency controls', exact: true }).getByText('app.read_only', { exact: true })).toBeVisible();
  await accessible(page, 'admin overview');

  // Jobs & workers: search, and the worker list.
  await nav.getByRole('button', { name: 'Jobs & workers' }).click();
  await expect(page).toHaveURL(/\/admin\/jobs$/);
  await page.getByRole('form', { name: 'Job search' }).getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('table', { name: 'Jobs' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Workers' })).toBeVisible();

  // Accounts & billing: metadata only, opened from a search.
  await nav.getByRole('button', { name: 'Accounts & billing' }).click();
  await page.getByLabel('Email, user or workspace id').fill(`${customer}@example.test`);
  await page.getByRole('form', { name: 'Account search' }).getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: `Open ${customer}@example.test` }).click();
  await expect(page.getByRole('region', { name: `${customer}@example.test` }).getByText('Storage')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grant override' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Copyright notices', exact: true })).toBeVisible();

  // AI routing: the tier map and the deployments.
  await nav.getByRole('button', { name: 'AI routing' }).click();
  await expect(page.getByRole('heading', { name: /Tier routing \(version/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Deployments' })).toBeVisible();

  // Security: the Owner's own assignment, sessions, grants and the audit log.
  await nav.getByRole('button', { name: 'Security' }).click();
  await expect(page.getByRole('table', { name: 'Role assignments' }).getByText('owner').first()).toBeVisible();
  await expect(page.getByRole('table', { name: 'Admin sessions' })).toBeVisible();
  await page.getByLabel('Action starts with').fill('admin.session');
  await page.getByRole('form', { name: 'Audit search' }).getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('table', { name: 'Audit events' }).getByText('admin.session.start').first()).toBeVisible();

  // Flags: a flag's impact preview (not applied), its history, and the per-user trace.
  await nav.getByRole('button', { name: 'Flags' }).click();
  await page.getByRole('button', { name: 'Open flag rooms', exact: true }).click();
  await page.getByLabel('Action').selectOption('off_for_tier');
  await page.getByRole('button', { name: 'Preview impact' }).click();
  await expect(page.getByLabel('Impact preview').getByText(/accounts change/)).toBeVisible();
  await expect(page.getByLabel('Impact preview').getByText(/wait 15 minutes/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Rule versions' })).toBeVisible();
  const account = await (await request.get('/api/account', { headers: { Authorization: `Bearer e2e:${customer}` } })).json();
  await page.getByLabel('User id').fill(account.user.id);
  await page.getByRole('button', { name: 'Explain' }).click();
  await expect(page.getByRole('table', { name: /Decisions for/ })).toBeVisible();
  await accessible(page, 'admin flags');

  await page.getByRole('button', { name: 'Leave console' }).click();
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
});

test('a role sees only the pages it can read', async ({ page, request }) => {
  await asStaff(page, request, 'support');
  const nav = await enter(page);
  await expect(nav.getByRole('button')).toHaveText(['Overview', 'Jobs & workers', 'Accounts & billing', 'Flags']);
});
