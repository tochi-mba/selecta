import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { allRendered, resetMix, spyOnAudio } from '../e2e/helpers';
import { settle, STRESS_MIX, writeJson } from './shared';

const AUDIO = resolve(process.cwd(), 'vc-checks/audio');

test('listening: export FLAC, seam clips and one-owner audio', async ({ page, request }) => {
  mkdirSync(AUDIO, { recursive: true });
  await resetMix(request, STRESS_MIX);
  await allRendered(request, 600_000);
  const { mix } = await (await request.get('/api/mix')).json();
  const songs = (mix as { song_id: number }[]).map((s) => s.song_id);
  const seams = (mix as { seam: { key?: string; state: { status: string } } | null }[]).map((s) => s.seam?.key).filter(Boolean) as string[];
  const report: Record<string, unknown> = { songs, seams };

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/mix/current/edit'); await settle(page);
  await page.getByRole('button', { name: 'Download audio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  report.exportDialog = await dialog.ariaSnapshot();
  const save = dialog.getByRole('button', { name: 'Save it', exact: true });
  if (await save.count()) await save.click();
  let job: { name: string; state: string; seconds: number; songs: { song_id: number }[] } | undefined;
  await expect.poll(async () => {
    const { jobs } = await (await request.get('/api/exports/jobs')).json();
    job = (jobs as NonNullable<typeof job>[]).find((j) => j.songs.map((s) => s.song_id).join() === songs.join() && j.state === 'ready');
    return job?.state;
  }, { timeout: 400_000, intervals: [3000] }).toBe('ready');
  report.job = { name: job!.name, seconds: job!.seconds };
  writeFileSync(resolve(AUDIO, 'export.flac'), await (await request.get(`/api/exports/${encodeURIComponent(job!.name)}`)).body());
  for (const id of songs) writeFileSync(resolve(AUDIO, `song-${id}.flac`), await (await request.get(`/api/songs/${id}/audio`)).body());
  writeFileSync(resolve(AUDIO, 'other.flac'), await (await request.get('/api/songs/9/audio')).body());
  for (const [index, key] of seams.entries()) {
    const clip = await request.get(`/api/seams/${encodeURIComponent(key)}/clip`);
    report[`clip-${index}`] = { status: clip.status(), type: clip.headers()['content-type'] };
    if (clip.ok()) writeFileSync(resolve(AUDIO, `seam-${index}.audio`), await clip.body());
  }

  // One owner: main mix plays, then a harmonic audition, then back.
  await spyOnAudio(page);
  const sounding = () => page.evaluate(() => ({
    media: [...document.querySelectorAll('audio, video')].filter((m) => !(m as HTMLMediaElement).paused).length,
    contexts: window.audioSpy.contexts.map((c) => c.state),
  }));
  try {
    await page.goto('/listen'); await settle(page);
    await page.locator('.now .transport .primary').click();
    await expect(page.locator('.now .transport .primary')).toHaveText('Pause', { timeout: 30_000 });
    report.mainPlaying = await sounding();
    await page.goto('/discover/harmonic'); await settle(page);
    report.harmonicTree = (await page.locator('main').ariaSnapshot()).slice(0, 3000);
    const audition = page.getByRole('button', { name: /^(Play|Listen|Hear)/ }).first();
    report.auditionButton = await audition.getAttribute('aria-label') ?? await audition.textContent();
    await audition.click();
    await page.waitForTimeout(2500);
    report.duringAudition = await sounding();
    report.miniDuringAudition = await page.locator('.mini').ariaSnapshot().catch(() => '');
    await page.goto('/listen'); await settle(page);
    await page.waitForTimeout(1500);
    report.backOnListen = { ...(await sounding()), button: await page.locator('.now .transport .primary').textContent() };
  } catch (error) { report.ownership = { error: String(error).slice(0, 300) }; }
  writeJson('listening', 'browser.json', report);
});
