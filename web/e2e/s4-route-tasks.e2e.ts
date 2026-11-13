import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * S4-0094-10: the route task scripts in s4-route-tasks.json. Each task opens its route, opens the
 * menu its action lives in (if any), and finds the action by role and name, visible and enabled.
 * An action that moved into a menu is still one press away, under a menu that says what it holds.
 */
type Task = { route: string; task: string; menu?: string; role: Parameters<import('@playwright/test').Page['getByRole']>[0]; name: string };
const { tasks } = JSON.parse(readFileSync(new URL('./s4-route-tasks.json', import.meta.url), 'utf8')) as { tasks: Task[] };

test.beforeEach(async ({ request, page }) => {
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
});

for (const task of tasks) {
  test(`${task.route}: ${task.task}`, async ({ page }) => {
    await page.goto(task.route);
    await expect(page.locator('main#main:not([aria-busy="true"])').locator('h1, h2').first()).toBeVisible();
    if (task.menu) {
      const opener = page.getByRole('button', { name: new RegExp(task.menu) }).first();
      await expect(opener).toBeVisible();
      await expect(opener).toHaveAttribute('aria-haspopup', 'menu');
      await opener.click();
      await expect(opener).toHaveAttribute('aria-expanded', 'true');
    }
    const control = page.getByRole(task.role, { name: new RegExp(task.name) }).first();
    await expect(control, `${task.route}: ${task.task}`).toBeVisible();
    await expect(control).toBeEnabled();
  });
}
