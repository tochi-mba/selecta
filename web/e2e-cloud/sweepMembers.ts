import { APIRequestContext, expect, Page } from '@playwright/test';
import { rewriteJson } from '../e2e/helpers';
import { LONG_TITLE } from '../e2e/layoutSweep';
import { listener } from './cloud';
import { connectOnThisDevice, seeded } from './localFirst';

// The people the Cloud layout sweeps sign in as, shared by layout-sweep*.cloud.ts.

/** The account answer this person gets: local-first or the hosted shell, with the layout flag.
 * The Listening Room is on, so its page is drawn rather than "not on this account". */
export async function amend(page: Page, { localFirst, layout }: { localFirst: boolean; layout: boolean }) {
  await page.route('**/api/account', (route) => rewriteJson(route, (account) => ({
    ...account,
    experience: { ...(account.experience ?? {}), local_first: localFirst, hosted: true },
    features: {
      ...account.features,
      ...(localFirst
        ? { 'cloud.local_first': true, 'cloud.local_media': true, 'cloud.progressive_import': true, 'cloud.offline_shell': true, 'cloud.workspace': true, 'cloud.mix_outbox': true, 'tools.listening_room': true }
        : { 'cloud.hosted_shell': true }),
      'cloud.page_layout': layout,
    },
  })));
}

/** Open `path` and wait for its heading and for the first reads to settle. */
export async function opened(page: Page, path: string, heading?: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Main' }).or(page.getByRole('navigation', { name: 'Cloud workspace' })).first()).toBeVisible();
  // a place this account lacks says so under its own heading, which is fine to measure too
  await expect(page.getByRole('heading', { level: 1, name: heading }).or(page.locator('main h1')).first()).toBeVisible();
  // the library's first read and the notices settle; the event stream never goes quiet, so this
  // waits a few seconds at most
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
}

/** A local-first member with the long title on this device too, so the Library and the mixes draw
 * it as playable. */
export async function localFirstMember(page: Page, request: APIRequestContext, name: string, layout: boolean) {
  const user = listener(name);
  const made = await seeded(request, user, { songs: 1, local_songs: 3, local_titles: [LONG_TITLE, 'Second song', 'Third song'] });
  await connectOnThisDevice(page, made.workspace_id, [{ songId: made.local_songs[0], title: LONG_TITLE, audio: true }]);
  await page.addInitScript((who) => localStorage.setItem('selecta-e2e-user', who), user);
  await amend(page, { localFirst: true, layout });
  return user;
}
