import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import { allRendered, resetMix } from '../e2e/helpers';
import { measure, ROUTES, settle, shot, STRESS_MIX, writeJson } from './shared';

const WIDTHS = [[320, 700], [768, 1024], [1440, 900]] as const;
const LIBRARY = /\/api\/library\?/;

test.beforeAll(async ({ request }) => {
  await resetMix(request, STRESS_MIX);
  await allRendered(request, 600_000);
});

async function themed(browser: Browser, width: number, height: number, theme: 'light' | 'dark') {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
  await context.addInitScript((chosen) => {
    localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' }));
  }, theme);
  return context;
}

for (const [width, height] of WIDTHS) {
  test(`visual ${width}`, async ({ browser }) => {
    const report: Record<string, unknown> = {};
    for (const theme of ['light', 'dark'] as const) {
      const context = await themed(browser, width, height, theme);
      const page = await context.newPage();
      const take = async (id: string, act: (p: Page) => Promise<void>) => {
        const name = `${width}-${theme}-${id}`;
        try {
          await act(page);
          await shot(page, 'visual', name);
          report[name] = { theme: await page.locator('html').getAttribute('data-theme'), ...(await measure(page)) };
        } catch (error) {
          report[name] = { error: String(error).slice(0, 300) };
        }
      };
      for (const [path, id] of ROUTES) await take(id, async (p) => { await p.goto(path); await settle(p); });

      await take('listen-playing', async (p) => {
        await p.goto('/listen'); await settle(p);
        await p.locator('.now .transport .primary').click();
        await expect(p.locator('.now .transport .primary')).toHaveText('Pause', { timeout: 30_000 });
        await p.waitForTimeout(1500);
      });
      await take('stage', async (p) => {
        await p.keyboard.press('f');
        await expect(p.locator('.now.stage')).toBeVisible();
        await p.waitForTimeout(500);
      });
      await take('export-dialog', async (p) => {
        await p.goto('/mix/current/edit'); await settle(p);
        await p.getByRole('button', { name: 'Download audio' }).click();
        await expect(p.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
      });
      await take('shape-dialog', async (p) => {
        await p.goto('/mixes'); await settle(p);
        await p.getByRole('button', { name: 'Customize' }).click();
        await expect(p.getByRole('dialog', { name: 'Shape the next mix' })).toBeVisible();
      });
      await take('requests-drawer', async (p) => {
        await p.goto('/listen'); await settle(p);
        await p.getByRole('button', { name: /^Requests/ }).first().click();
        await p.waitForTimeout(500);
      });
      await take('palette', async (p) => {
        await p.goto('/library'); await settle(p);
        await p.keyboard.press('Control+k');
        await expect(p.getByRole('dialog', { name: 'Search and commands' })).toBeVisible();
      });
      await take('inspector', async (p) => {
        await p.goto('/mix/current/edit'); await settle(p);
        const row = p.locator('main li button, main [role="row"] button').filter({ hasText: /./ }).first();
        await row.click().catch(() => undefined);
        await p.waitForTimeout(500);
      });
      await take('library-empty', async (p) => {
        await p.goto('/library?q=nothing-is-called-this');
        await expect(p.getByText(/Nothing matches/)).toBeVisible();
      });
      if (width !== 768) {
        const held: Route[] = [];
        await take('library-loading', async (p) => {
          await p.route(LIBRARY, (route) => void held.push(route));
          await p.goto('/library');
          await expect(p.locator('main .skeleton').first()).toBeVisible();
          await p.waitForTimeout(600);
        });
        await page.unroute(LIBRARY);
        for (const route of held.splice(0)) await route.fallback().catch(() => undefined);
        let fail = true;
        await take('library-failed', async (p) => {
          await p.route(LIBRARY, (route) => (fail ? route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } }) : route.fallback()));
          await p.goto('/library');
          await expect(p.locator('main .problem[role="alert"]')).toBeVisible();
        });
        await take('library-recovered', async (p) => {
          fail = false;
          await p.locator('main .problem[role="alert"]').getByRole('button', { name: 'Try again' }).click();
          await expect(p.locator('.library-rows li').first()).toBeVisible();
        });
        await page.unroute(LIBRARY);
        await take('gallery', async (p) => {
          await p.goto('/workshop/diagnostics'); await settle(p);
          const open = p.getByText(/control gallery/i).first();
          await open.click().catch(() => undefined);
          await p.locator('.control-gallery, [aria-label*="gallery" i]').first().scrollIntoViewIfNeeded().catch(() => undefined);
        });
      }
      await context.close();
    }
    writeJson('visual', `metrics-${width}.json`, report);
  });
}
