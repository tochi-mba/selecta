import { expect, test } from '@playwright/test';
import { accessible, listener } from './cloud';
import { openLocalFirst, seeded } from './localFirst';

// Plan W5b: the Cloud site is installable and the Browser storage card (Workspace > Storage) can ask the browser to keep
// SelectaDJ's details. What the browser answers to persist() is its own decision (headless Edge
// usually says no to a site it has never seen), so the test accepts either honest answer and
// checks the words match it; it never forces a grant.

test('the manifest is served with its type, parses, and every icon it names is there', async ({ request }) => {
  const answer = await request.get('/manifest.webmanifest');
  expect(answer.status()).toBe(200);
  expect(answer.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await answer.json();
  expect(manifest).toMatchObject({ name: 'SelectaDJ', short_name: 'SelectaDJ', display: 'standalone', start_url: '/', scope: '/' });
  for (const icon of manifest.icons as { src: string; type: string }[]) {
    const file = await request.get(icon.src);
    expect(file.status(), icon.src).toBe(200);
    expect(file.headers()['content-type'], icon.src).toContain(icon.type);
  }
});

test('the page links the manifest, and the storage card offers to keep this device’s details', async ({ page, request }) => {
  const user = listener('pwa-storage');
  await seeded(request, user, { local_songs: 1 });
  // with cloud.workspace the storage card lives on Workspace > Storage
  await openLocalFirst(page, user, '/workshop/storage');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');

  const card = page.getByRole('region', { name: 'Browser storage' });
  const words = card.locator('[data-persist]');
  await expect(words).toContainText('SelectaDJ is using');
  await expect(words).toContainText('Your music files are never in browser storage');
  await accessible(page, 'This device storage card');
  const before = await words.getAttribute('data-persist');
  if (before === 'granted') {
    await expect(words).toContainText("This browser keeps SelectaDJ's details on this device");
    return;
  }
  expect(before).toBe('not_granted');
  const keep = card.getByRole('button', { name: "Keep this device's details safe" });
  await expect(keep).toBeVisible();
  await keep.click();
  await expect(words).not.toHaveAttribute('data-persist', 'not_granted');
  const after = await words.getAttribute('data-persist');
  const persisted = await page.evaluate(() => navigator.storage.persisted());
  // the card says granted only when the browser really did
  expect(after === 'granted').toBe(persisted);
  if (after === 'granted') await expect(words).toContainText("This browser keeps SelectaDJ's details");
  else await expect(words).toContainText('The browser may clear them');
});
