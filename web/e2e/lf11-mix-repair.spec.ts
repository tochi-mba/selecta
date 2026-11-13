import { expect, test } from '@playwright/test';
import { listener, signedIn } from '../e2e-cloud/cloud';

/**
 * LF11 browser contract. These scenarios deliberately use synthetic song IDs,
 * no commercial audio, no sound output and no cloud audio upload.
 *
 * Discovery note: existing playwright*.config.ts match *.e2e.ts or *.cloud.ts.
 * Integrator must wire the LF11 *.spec.ts suite into the cloud E2E project.
 */
const revision = 'revision-original';
const ids = Array.from({ length: 8 }, (_, i) => `synthetic-${i}`);
const songs = ids.map((id, i) => ({
  id, occurrence_id: `occ-${i}`, source: 'local-recipe',
  title: `Synthetic Track ${i + 1}`, artist: 'Synthetic Artist',
  duration: 60, facts: { bpm: null, camelot: null, energy: null },
}));
const mix = { mix_id: 'fixture-eight', name: 'Eight track fixture',
  revision, number: 4, parent: 'revision-three', songs, seams: [],
  intelligent_seams: 0 };
const summary = { mix_id: mix.mix_id, name: mix.name, revision,
  number: 4, songs: 8, intelligent_seams: 0, updated_at: 1 };
const history = [{ revision, number: 4, name: mix.name, songs: 8 },
  { revision: 'revision-three', number: 3, name: mix.name, songs: 8 }];
type Scenario = { delayed?: boolean; disconnected?: boolean; conflict?: boolean; stale?: boolean };
function readiness(device: string, scenario: Scenario) {
  const now = Date.now();
  return {
    device_id: device, mix_id: mix.mix_id, revision,
    checked_at: scenario.stale ? now - 500_000 : now,
    local_verification: true, engine_healthy: true,
    source_connected: !scenario.disconnected,
    output_verified: true, policy_allowed: true, playback_window_free: true,
    tracks: songs.map((song, i) => ({
      occurrence_id: song.occurrence_id,
      state: device === 'speaker-b' ? 'Missing' : i < 5 ? 'Ready' : i < 7 ? 'Missing' : 'Candidate',
      reason: i === 7 ? 'Candidate is a different clean/explicit variant' : '',
      candidate_id: i === 7 ? 'wrong-variant' : undefined,
      candidate_explicit: false, equivalent_verified: false,
      verified_at: now, cue_valid: true, seam_valid: true, preview_valid: true,
    })),
  };
}
async function openFixture(page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext, scenario: Scenario = {}) {
  const originalWrites: unknown[] = [];
  await page.route('**/api/account', async route => {
    const upstream = await route.fetch();
    const body = await upstream.json();
    await route.fulfill({ response: upstream,
      json: { ...body, features: { ...body.features, 'local_first.mix_readiness': true } } });
  });
  await page.route('**/api/cloud-mixes**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/revisions')) {
      originalWrites.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409, contentType: 'application/json',
        body: JSON.stringify({ detail: { code: 'revision_conflict', message: 'The recipe changed on another device.' } }),
      });
    } else if (url.pathname.endsWith('/fixture-eight')) {
      await route.fulfill({ json: { mix, history } });
    } else {
      await route.fulfill({ json: { mixes: [summary] } });
    }
  });
  await page.route('**/api/local-first/devices', route => route.fulfill({ json: {
    devices: [
      { id: 'speaker-a', name: 'Studio PC', connected: true, outputVerified: true },
      { id: 'speaker-b', name: 'Other speaker', connected: true, outputVerified: true },
    ],
  } }));
  await page.route('**/api/local-first/devices/*/mixes/*/availability?**', async route => {
    if (scenario.delayed && route.request().url().includes('/speaker-a/')) {
      await new Promise(resolve => setTimeout(resolve, 900));
    }
    const device = route.request().url().includes('/speaker-b/') ? 'speaker-b' : 'speaker-a';
    await route.fulfill({ json: readiness(device, scenario) });
  });
  await signedIn(page, request, listener('lf11'), { path: '/listen', songs: 0 });
  await expect(page.getByRole('button', { name: mix.name })).toBeVisible();
  await page.getByRole('button', { name: mix.name }).click();
  const editor = page.getByRole('group', { name: `Edit ${mix.name}` });
  await expect(editor).toBeVisible();
  return { editor, originalWrites };
}

test('eight tracks: 5 ready, 2 missing, 1 candidate; every repair path preserves the original', async ({ page, request }) => {
  const { editor, originalWrites } = await openFixture(page, request);
  await expect(editor.getByText(/5\\/8 exact recordings verified/)).toBeVisible();
  await expect(editor.getByText('Missing', { exact: true })).toHaveCount(2);
  await expect(editor.getByText('Candidate', { exact: true })).toHaveCount(1);
  await expect(editor.getByText('Playable: No')).toBeVisible();
  await expect(editor.getByText(/Not verified as the same recording/)).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Locate local recording' }).first()).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Review alternate version' })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Control a device with the music' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Create temporary playable variation' }).click();
  await expect(editor.getByText(/5 verified tracks selected; 3 skipped/)).toBeVisible();
  await editor.getByRole('button', { name: 'Copy to editable draft' }).click();
  await expect(editor.getByRole('button', { name: 'Save as a new version' })).toBeEnabled();
  await expect(editor.getByRole('list', { name: 'Earlier versions' }).getByText(/Version 3/)).toBeVisible();
  expect(originalWrites).toEqual([]);
  expect(mix.revision).toBe(revision);
  expect(mix.songs).toHaveLength(8);
});

test('offline editor and conflicting revision never silently overwrite history', async ({ page, request }) => {
  const { editor, originalWrites } = await openFixture(page, request, { conflict: true });
  await editor.getByRole('button', { name: 'Move Synthetic Track 1 later' }).click();
  await editor.getByRole('button', { name: 'Save as a new version' }).click();
  await expect(page.getByRole('alert')).toContainText('The recipe changed on another device.');
  expect(originalWrites).toHaveLength(1);
  expect((originalWrites[0] as { base_revision: string }).base_revision).toBe(revision);
  await page.context().setOffline(true);
  await editor.getByRole('button', { name: 'Undo edit' }).click();
  await expect(editor.getByText(/arrangement remains editable/)).toBeVisible();
  expect(mix.revision).toBe(revision);
});

test('stale and disconnected verification never enables a fabricated preview', async ({ page, request }) => {
  const { editor } = await openFixture(page, request, { disconnected: true, stale: true });
  await expect(editor.getByText(/local verification is missing, disconnected or older than two minutes/)).toBeVisible();
  await expect(editor.getByText('Playable: No')).toBeVisible();
  await expect(editor.getByText('Auditionable: No')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Create temporary playable variation' })).toBeDisabled();
  await expect(editor.locator('audio, video, canvas[data-fake-waveform]')).toHaveCount(0);
});

test('late verification for another device cannot win; keyboard focus and narrow layout recover', async ({ page, request }) => {
  const { editor } = await openFixture(page, request, { delayed: true });
  const choice = editor.getByLabel('Verify for device');
  await choice.focus();
  await expect(choice).toBeFocused();
  await choice.selectOption('speaker-b');
  await expect(choice).toBeFocused();
  await expect(editor.getByText(/0\\/8 exact recordings verified/)).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(editor.getByText(/0\\/8 exact recordings verified/)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  const panel = editor.getByRole('region', { name: 'Device mix readiness and repair' });
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(320);
});
