import { expect, Page, test } from '@playwright/test';
import { listener } from './cloud';

// BF-0462-06 / BF-0459-04 / BF-0465-03: the local-first player on the ADR-0457 runtime.
//
// The harness page (/harness?runtime=1, src/harness/runtime.tsx) mounts the shell's own player
// hook over the real browser engine and the real playback session, with a two-song programme:
// song 1 resolves on this device, song 2 exists only as a seeded hosted asset and is played
// through the cloud.stored_media playback-url route. The browser runs muted (ADR-0466), so every
// assertion is about state transitions and the seam events the runtime scheduled, never about
// what anyone would hear.

type Report = {
  phase: string;
  position: number;
  nextReady: boolean;
  seamAt: number | null;
  notice: string;
  seams: {
    fromIndex: number;
    toIndex: number;
    sources: { a: string | null; b: string | null };
    kind: string;
    style: string | null;
    reason: string | null;
    degraded: { wanted: string; instead: string; reason: string }[];
    startSeconds: number;
    windowSeconds: number;
    implementation: string;
    events: string[];
  }[];
};

async function report(page: Page): Promise<Report> {
  return JSON.parse(await page.getByTestId('runtime-state').innerText()) as Report;
}

test('the runtime plays a mixed-source set through a scheduled seam', async ({ page, request }) => {
  test.setTimeout(150_000);
  const user = listener('runtime');
  // one hosted song of 40 s ("Song 1.wav"), the programme's second song
  const seeded = await request.post('/test/seed', { data: { user, songs: 1, seconds: 40 } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.goto(`/harness?as=${encodeURIComponent(`e2e:${user}`)}&runtime=1`);

  const state = page.getByTestId('runtime-state');
  await expect(state).toContainText('"phase":"idle"');
  const sources = page.getByTestId('queue-sources');
  await expect(sources.locator('li').nth(0)).toHaveAttribute('data-source', 'pending');

  await page.getByRole('button', { name: 'Play the runtime set' }).click();

  // idle -> playing on song 1, which resolved on the device
  await expect.poll(async () => (await report(page)).phase, { timeout: 30_000 }).toBe('playing');
  expect((await report(page)).position).toBe(0);
  await expect(sources.locator('li').nth(0)).toHaveAttribute('data-source', 'device');

  // the seam into song 2 is scheduled ahead of time; song 2 fell back to the hosted copy
  await expect.poll(async () => (await report(page)).seams.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(sources.locator('li').nth(1)).toHaveAttribute('data-source', 'hosted');
  const planned = await report(page);
  const seam = planned.seams[0];
  expect(seam.fromIndex).toBe(0);
  expect(seam.toIndex).toBe(1);
  expect(seam.sources).toEqual({ a: 'device', b: 'hosted' });
  expect(seam.style).toBe('bass_swap_blend');
  // the honesty rules: a test tone has no beat, so the asked-for bass swap is degraded to the
  // labelled fade, never claimed; and nothing leaves a song before 30 s (leave_after)
  expect(seam.kind).toBe('fade');
  expect(seam.reason).toMatch(/tempo/);
  expect(seam.degraded.map((step) => step.instead)).toContain('fade');
  expect(seam.startSeconds).toBeGreaterThanOrEqual(30);
  expect(seam.events).toEqual(expect.arrayContaining(['b:start', 'a:gain', 'b:gain', 'a:stop']));
  expect(seam.implementation).toContain('browser-seam-script-v1');
  expect(planned.nextReady).toBe(true);
  expect(planned.seamAt).toBe(seam.startSeconds);

  // pause and resume keep the state truthful
  await page.getByRole('button', { name: 'Pause or resume' }).click();
  await expect.poll(async () => (await report(page)).phase).toBe('paused');
  await page.getByRole('button', { name: 'Pause or resume' }).click();
  await expect.poll(async () => (await report(page)).phase).toBe('playing');

  // the scheduled seam carries the set into the hosted song
  await expect.poll(async () => (await report(page)).position, { timeout: 60_000, intervals: [1000] }).toBe(1);
  expect((await report(page)).phase).toBe('playing');
});
