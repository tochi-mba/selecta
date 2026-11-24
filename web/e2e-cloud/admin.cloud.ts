import { expect, test } from '@playwright/test';
import { accessible, asStaff, enterConsole as enter, listener, signedIn } from './cloud';

// The staff console (doc 07b) against the real Cloud API: an Owner enters an admin session and
// walks the pages. Nothing here changes shared state another test could notice: the console stays
// in view mode except where a test says otherwise, and changes are previewed, not saved.

test('a customer never sees the staff console', async ({ page, request }) => {
  await signedIn(page, request, listener('customer'));
  await expect(page.getByRole('button', { name: 'Staff console' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Staff console' })).toHaveCount(0);
});

test('an Owner walks through the console pages', async ({ page, request }) => {
  const customer = listener('listener');
  await request.post('/test/seed', { data: { user: customer, songs: 1, seconds: 4 } });
  await asStaff(page, request);
  const nav = await enter(page, { changes: false });
  await expect(nav.getByRole('link')).toHaveText(['Overview', 'Customers', 'Billing', 'Jobs', 'AI', 'Flags', 'Content', 'Emergency', 'Staff and security', 'Communications', 'System']);
  await expect(page.getByText('Viewing. Nothing you do here changes anything.')).toBeVisible();

  // Overview: one sentence first, plain names, and what feeds what is not reporting.
  await expect(page.locator('.admin-headline')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Services' }).getByText('Database', { exact: true })).toBeVisible();
  await accessible(page, 'admin overview');

  // Jobs: the worker list.
  await nav.getByRole('link', { name: 'Jobs' }).click();
  await expect(page).toHaveURL(/\/admin\/jobs$/);
  await expect(page.getByRole('table', { name: 'Workers' })).toBeVisible();

  // Customers: search (never an unfiltered list), then the record with its tabs.
  await nav.getByRole('link', { name: 'Customers' }).click();
  await expect(page.getByText('Search to begin.')).toBeVisible();
  await page.getByLabel('Email, user or workspace id').fill(`${customer}@example.test`);
  await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: `Open ${customer}@example.test` }).click();
  await expect(page.getByRole('heading', { name: `${customer}@example.test` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Suspend…' })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Customer sections' }).getByRole('link', { name: 'Configuration' }).click();
  await expect(page.getByRole('region', { name: 'Storage mode' })).toBeVisible();
  await accessible(page, 'admin customer');

  // Staff and security: the Owner, the role matrix and the audit log.
  await nav.getByRole('link', { name: 'Staff and security' }).click();
  await expect(page.getByRole('region', { name: 'Staff', exact: true }).getByText('Owner').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Staff and security sections' }).getByRole('link', { name: 'Audit log' }).click();
  await page.getByLabel('Action starts with').fill('admin.session');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page.getByRole('region', { name: 'Audit events' }).getByText('admin.session.start').first()).toBeVisible();

  // Flags: a flag's impact preview (not applied) and the per-user trace.
  await nav.getByRole('link', { name: 'Flags' }).click();
  await page.getByRole('button', { name: 'Open flag rooms', exact: true }).click();
  await page.getByLabel('Action').selectOption('off_for_tier');
  await page.getByRole('button', { name: 'Preview impact' }).click();
  await expect(page.getByLabel('Impact preview').getByText(/accounts change/)).toBeVisible();
  const account = await (await request.get('/api/account', { headers: { Authorization: `Bearer e2e:${customer}` } })).json();
  await page.getByLabel('User id').fill(account.user.id);
  await page.getByRole('button', { name: 'Explain' }).click();
  await expect(page.getByRole('table', { name: /Decisions for/ })).toBeVisible();
  await accessible(page, 'admin flags');

  await page.getByRole('button', { name: 'Leave console' }).click();
  await expect(page).not.toHaveURL(/\/admin/);
});

test('a role sees only the pages it can read', async ({ page, request }) => {
  await asStaff(page, request, 'support');
  const nav = await enter(page, { changes: false });
  await expect(nav.getByRole('link')).toHaveText(['Overview', 'Customers', 'Billing', 'Jobs', 'Flags', 'Emergency', 'Communications', 'System']);
});
