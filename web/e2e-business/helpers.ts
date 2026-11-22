import { expect, Page } from '@playwright/test';

export type Seeded = { org: string; venues: string[]; zones: string[] };

/** The made-up pilot organisation owned by `owner` (tests/e2e_cloud_business.py). */
export async function seedBusiness(page: Page, owner: string, extra: { staff?: string; selling?: boolean } = {}): Promise<Seeded> {
  const made = await page.request.post('/test/business/seed', { data: { user: owner, ...extra } });
  expect(made.ok(), await made.text()).toBeTruthy();
  return (await made.json()) as Seeded;
}

/** How far the page scrolls sideways, in CSS pixels. */
export function sideways(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
