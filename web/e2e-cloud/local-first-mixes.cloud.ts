import { expect, test } from '@playwright/test';
import { listener } from './cloud';
import { asLocalFirst, connectOnThisDevice, seeded } from './localFirst';

// BF-0462-05: the shared Make a Mix, MixSetup and My Mixes render in local-first Cloud against the
// recipe store. A mix made here is a recipe on the real e2e server (immutable revisions over
// catalogue identities); this browser keeps which recipe is its current mix, so the mix is still
// there after a reload. BF-0465-03: a grandfathered account's mix plays one song from this device
// and one from its hosted library, and the queue says which is which.
//
// What this cannot show: how the transition sounds. The browser works each one out as it plays;
// only listening can judge it.

test('a new member makes a mix from the songs on this device, and it is still there after a reload', async ({ page, request }) => {
  const user = listener('lf-mixes');
  const made = await seeded(request, user, { local_songs: 3, local_titles: ['Alpha here', 'Bravo here', 'Charlie away'] });
  const [alpha, bravo] = made.local_songs;
  await asLocalFirst(page, user);
  await connectOnThisDevice(page, made.workspace_id, [{ songId: alpha, title: 'Alpha here', audio: true }, { songId: bravo, title: 'Bravo here', audio: true }]);

  await page.goto('/mixes');
  await expect(page.getByRole('heading', { name: 'Make a Mix', level: 1 })).toBeVisible();
  // the quick mix (QuickMix.tsx): what can play here, then the mix it will play and how long
  const quick = page.getByRole('region', { name: 'Make a new mix' });
  await expect(quick.getByText('2 of 3 songs can play on this device.')).toBeVisible();
  await expect(quick.locator('.quick-play-words')).toContainText('Your songs, in your browser');
  await expect(quick.locator('.quick-play-words')).toContainText('2 songs.');

  // MixSetup: only what a browser mix can honour, the ending; no feel, energy or stem controls
  await page.getByRole('button', { name: /Shape this mix/ }).click();
  const setup = page.getByRole('dialog', { name: 'Shape the next mix' });
  await expect(setup.getByLabel('Take me to')).toBeVisible();
  await expect(setup.getByRole('region', { name: 'Energy arc controls' })).toHaveCount(0);
  await setup.getByLabel('Take me to').fill('Alpha');
  await setup.getByRole('option').getByRole('button', { name: /Alpha here/ }).click();
  await expect(setup.getByText('Mixes will try to finish on')).toBeVisible();
  await setup.getByRole('button', { name: 'Done shaping' }).click();

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page).toHaveURL(/\/listen$/);
  await expect(page.getByText('Bravo here').first()).toBeVisible();

  // the recipe is on the server: one recipe, the device songs only, ending where it was asked to
  const listed = await page.evaluate(async () => {
    const user = localStorage.getItem('selecta-e2e-user');
    const account = await (await fetch('/api/account', { headers: { authorization: `Bearer e2e:${user}` } })).json();
    const answer = await fetch('/api/local-media/recipes', { headers: { authorization: `Bearer e2e:${user}`, 'x-workspace-id': account.workspace.id } });
    return (await answer.json()).recipes as { mix_id: string; songs: number }[];
  });
  expect(listed.map((recipe) => recipe.songs)).toEqual([2]);

  // a reload keeps the current mix: My Mixes reads it back from the recipe store
  await page.goto('/mixes/mine');
  await expect(page.getByRole('heading', { name: 'My Mixes' })).toBeVisible();
  // named after its own songs, so two mixes never share a title
  const saved = page.getByRole('region', { name: /^Saved mixes/ }).getByRole('listitem').filter({ hasText: 'Bravo here to Alpha here' });
  await expect(saved).toHaveCount(1);
  await expect(saved).toContainText('Current mix');
  await expect(saved).toContainText('2 songs');
  // and Listen plays it in the order the recipe keeps: the ending chosen in MixSetup last
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Listen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bravo here' })).toBeVisible();
});

test('a grandfathered account mixes a device song with a hosted one, and the queue names both sources', async ({ page, request }) => {
  const user = listener('lf-mixed');
  // "Song 1.wav" is hosted; the catalogue's "Song 1" is that song by its exact name
  const made = await seeded(request, user, { songs: 1, seconds: 12, local_songs: 2, local_titles: ['Device song', 'Song 1'] });
  const [device] = made.local_songs;
  await asLocalFirst(page, user, { hosted: true });
  await connectOnThisDevice(page, made.workspace_id, [{ songId: device, title: 'Device song', audio: true }]);

  await page.goto('/library');
  // each row's one chip says it plays; its title says from where (LibraryRow.tsx, 02889fe5)
  const chip = (title: string) => page.locator('li.song-row', { hasText: title }).locator('.lw-state .status');
  await expect(chip('Device song')).toHaveText('Ready');
  await expect(chip('Device song')).toHaveAttribute('title', 'The file is connected here and can play.');
  await expect(chip('Song 1')).toHaveText('Ready');
  await expect(chip('Song 1')).toHaveAttribute('title', 'Plays from your cloud library in SelectaDJ.');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Make a Mix', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page).toHaveURL(/\/listen$/);
  const queue = page.getByTestId('queue-sources');
  await expect(queue.locator('li', { hasText: 'Device song' })).toContainText('From this device', { timeout: 20_000 });
  // the hosted song is looked up as the engine reaches for it, which locally can take some
  // seconds after the first press of a visit (T-20261125-b2cd)
  await expect(queue.locator('li', { hasText: 'Song 1' })).toContainText('From your cloud library', { timeout: 40_000 });
});
