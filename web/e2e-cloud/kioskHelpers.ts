import { APIRequestContext, expect, Page } from '@playwright/test';

// Shared steps for the kiosk browser specs (*.kiosk.ts).

export type Org = { org: string; venue: string; zone: string };
export const ALICE = 'Bearer alice';

export async function makeOrg(request: APIRequestContext, open = true, extra: Record<string, unknown> = {}): Promise<Org> {
  const made = await request.post('/test/kiosk/org', { data: { user: 'alice', songs: 3, open, ...extra } });
  expect(made.ok()).toBe(true);
  return made.json();
}

export async function managerPairs(request: APIRequestContext, baseURL: string, org: Org, code: string) {
  return request.post('/api/kiosk/pair', {
    headers: { Authorization: ALICE, 'X-Workspace-ID': org.org, Origin: baseURL },
    data: { code, zone_id: org.zone, name: 'Bar player' },
  });
}

export async function shownCode(kiosk: Page): Promise<string> {
  const code = kiosk.locator('#k-code');
  await expect(code).toHaveText(/^[2-9A-Z]{6}$/, { timeout: 20_000 });
  return (await code.textContent()) ?? '';
}

export async function pairedKiosk(page: Page, baseURL: string, org: Org): Promise<void> {
  await page.goto('/kiosk');
  const code = await shownCode(page);
  const paired = await managerPairs(page.request, baseURL, org, code);
  expect(paired.status(), await paired.text()).toBe(201);
}

export const audible = (page: Page) => expect(page.locator('html')).toHaveAttribute('data-audible', 'yes', { timeout: 60_000 });

