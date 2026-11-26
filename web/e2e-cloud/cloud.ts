import AxeBuilder from '@axe-core/playwright';
import { APIRequestContext, expect, Page } from '@playwright/test';

/** Each test signs in as its own listener, so tests never share a workspace. */
export function listener(name: string) {
  return `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Sign `user` up with `songs` ready songs, and open the site signed in as them. */
export async function signedIn(
  page: Page,
  request: APIRequestContext,
  user: string,
  { songs = 0, seconds = 4, path = '/', realProxy = false } = {},
) {
  const seeded = await request.post('/test/seed', { data: { user, songs, seconds, real_proxy: realProxy } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Cloud workspace' })).toBeVisible();
  return (await seeded.json()) as { workspace_id: string; assets: string[] };
}

/** A new test person given a staff role, signed in on `page`. */
export async function asStaff(page: Page, request: APIRequestContext, role = 'owner') {
  const name = listener(role);
  await signedIn(page, request, name);
  const made = await request.post('/test/staff', { data: { user: name, role } });
  expect(made.ok(), await made.text()).toBeTruthy();
  await page.reload();
  return name;
}

/** Open the staff console from the Cloud site and enter an admin session; the console's menu. */
export async function enterConsole(page: Page, { changes = true }: { changes?: boolean } = {}) {
  await page.getByRole('button', { name: 'Staff console' }).or(page.getByRole('menuitem', { name: 'Staff console' })).first().click();
  await expect(page).toHaveURL(/\/admin$/);
  // The console enters by itself while the sign-in is fresh; otherwise it asks.
  const nav = page.getByRole('navigation', { name: 'Console pages' });
  const enter = page.getByRole('button', { name: 'Enter console' });
  await expect(nav.or(enter)).toBeVisible();
  if (await enter.isVisible()) await enter.click();
  await expect(nav).toBeVisible();
  const skip = page.getByRole('region', { name: 'Welcome to the staff console' }).getByRole('button', { name: 'Skip' });
  if (await skip.isVisible()) await skip.click();
  // The console opens in view mode (doc 07b §7B.7); tests that change things press Make changes.
  if (changes) {
    await page.getByRole('button', { name: 'Make changes' }).click();
    await expect(page.getByRole('button', { name: 'Stop making changes' })).toBeVisible();
  }
  return nav;
}

export async function r2Log(request: APIRequestContext) {
  return ((await (await request.get('/test/r2/log')).json()) as { requests: { method: string; key: string; part?: number; serial?: number; status: number; time: number }[] }).requests;
}

/** Waits for the page's finite animations to end, so contrast is read from the settled page: at a
 * wide window the rail opens and its words fade in one after another (feel-shell.css), and axe
 * read the last ones half faded. Endless animations (playing bars) are left; 3 s at most. */
async function settled(page: Page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const ending = document.getAnimations()
      .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
      .map((animation) => animation.finished.catch(() => undefined));
    await Promise.race([Promise.all(ending), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  });
}

/** Accessibility, both themes, phone and desktop widths, nothing sticking out sideways. */
export async function accessible(page: Page, where: string) {
  const found: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await settled(page);
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      for (const problem of violations) for (const node of problem.nodes) found.push(`${where} ${scheme} ${width}: ${problem.id} ${String(node.target)}`);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 1) found.push(`${where} ${scheme} ${width}: scrolls sideways by ${wide}px`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  expect(found).toEqual([]);
}

/** cloud.move_to_cloud: a personal workspace agrees to the upload statement once, before its
 * first upload. Add music holds Start upload until it knows; call after choosing the files. */
export async function agreeIfAsked(page: Page): Promise<void> {
  const agree = page.getByRole('button', { name: 'I agree' });
  const start = page.getByRole('button', { name: 'Start upload' });
  await expect.poll(async () => (await agree.isVisible()) || (await start.isEnabled()), { timeout: 15_000 }).toBe(true);
  if (await agree.isVisible()) {
    await agree.click();
    await expect(agree).toBeHidden();
  }
}
