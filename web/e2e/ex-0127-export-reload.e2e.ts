import { expect, test } from '@playwright/test';

/**
 * EX-0127-02 (Experience programme, Export): an export job is server-side and durable. Closing the
 * dialog and reloading the page neither cancels it nor starts a second one; the dialog and the
 * Workshop list find the same job again.
 */

type Job = { id: string; scope: string; draft: number | null; state: string; mix_name: string; can_cancel?: boolean };

test('EX-0127-02 an export survives closing its dialog and a page reload, without a duplicate', async ({ page, request }) => {
  const made = await (await request.post('/api/drafts', { data: { name: 'Reload target' } })).json();
  try {
    for (const song of [8, 9, 10]) await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: song } });
    const ours = async () => ((await (await request.get('/api/exports/jobs')).json()).jobs as Job[])
      .filter((job) => job.scope === 'draft' && job.draft === made.id);

    await page.goto(`/mixes/drafts/${made.id}/edit`);
    await page.getByRole('button', { name: 'Download audio' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
    await dialog.getByRole('button', { name: 'Save it', exact: true }).click();
    await expect.poll(async () => (await ours()).length, { timeout: 20_000 }).toBe(1);
    const [job] = await ours();

    // dismissing the overlay is not cancelling the job
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const afterClose = await ours();
    expect(afterClose.map((entry) => entry.id)).toEqual([job.id]);
    expect(afterClose[0].state).not.toBe('cancelled');

    // a reload finds the same job, in the dialog and in the Workshop, and starts nothing new
    await page.reload();
    await page.getByRole('button', { name: 'Download audio' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Export progress' })).toBeVisible();
    await expect(dialog.getByRole('status').or(dialog.locator('a[href^="/api/exports/"]')).first()).toBeVisible();
    await expect(dialog.getByText(/original order below cannot be changed/)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/workshop');
    await expect(page.locator('.exports-list .export-job').filter({ hasText: 'Reload target' }).first()).toBeVisible();
    const afterReload = await ours();
    expect(afterReload.map((entry) => entry.id)).toEqual([job.id]);
    expect(afterReload[0].state).not.toBe('cancelled');
    if (afterReload[0].can_cancel) await request.delete(`/api/exports/jobs/${job.id}`);
  } finally {
    await request.delete(`/api/drafts/${made.id}`);
  }
});
