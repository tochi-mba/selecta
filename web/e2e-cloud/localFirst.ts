import { APIRequestContext, expect, Page } from '@playwright/test';

// Shared by the local-first cloud specs (ADR-0462/0463).
//
// The build ships `cloud.local_first` off by default and a per-user rule can never grant what
// the build denies (ADR-0414), so these specs turn it on for their one person by amending the
// account answer in the browser: the server's own decision is replaced only for the fields that
// make a local-first member (`experience`, `features["cloud.local_first"]`). The e2e build
// grandfathers every person into hosted media, so `experience.hosted` is set by the spec: false
// for a new local-first member, true for a grandfathered one. Everything else, including the
// catalogue songs and the catalogue routes (on in the e2e build), comes from the real e2e server.

export type Seed = {
  songs?: number;
  local_songs?: number;
  local_titles?: string[];
  local_absent?: number;
};

export async function seeded(request: APIRequestContext, user: string, seed: Seed): Promise<{ workspace_id: string; local_songs: number[] }> {
  const answer = await request.post('/test/seed', { data: { user, ...seed } });
  expect(answer.ok(), await answer.text()).toBeTruthy();
  return await answer.json();
}

/** Sign in as `user` with the local-first experience on, without opening a page yet. */
export async function asLocalFirst(page: Page, user: string, { hosted = false }: { hosted?: boolean } = {}) {
  await page.route('**/api/account', async (route) => {
    try {
      const answer = await route.fetch();
      const account = await answer.json();
      account.experience = { ...(account.experience ?? {}), local_first: true, hosted };
      account.features = { ...account.features, 'cloud.local_first': true, 'cloud.local_media': true };
      await route.fulfill({ response: answer, json: account });
    } catch {
      // the test ended while an account refresh was in flight: nothing is waiting for it
    }
  });
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
}

/** Open `path` as `user`, with the local-first experience switched on for them. */
export async function openLocalFirst(page: Page, user: string, path: string, options: { hosted?: boolean } = {}) {
  await asLocalFirst(page, user, options);
  await page.goto(path);
}
