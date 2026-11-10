/* LX-0355-02 and -04: Lucy's two panes on a wide screen, against the made-up library from
 * tests/e2e_server.py and Lucy's built-in planner (no AI service is ever called). */
import { APIRequestContext, expect, test } from '@playwright/test';
import { resetMix } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMix(request);
  await request.put('/api/lucy/settings', { data: { enabled: true } });
});

type Snap = { messages: { role: string; status: string }[]; proposal: { current: { id: string; number: number } } | null };
const snapshot = async (request: APIRequestContext, id: string): Promise<Snap> => (await request.get(`/api/lucy/conversations/${id}`)).json();

async function say(request: APIRequestContext, id: string, text: string, expected: string | null) {
  const answered = (await snapshot(request, id)).messages.filter((m) => m.role === 'assistant' && m.status === 'complete').length;
  const sent = await request.post(`/api/lucy/conversations/${id}/turns`, {
    data: { client_id: `lxp-${Date.now()}-${Math.random()}`, text, expected_revision: expected },
  });
  expect(sent.ok()).toBe(true);
  await expect.poll(async () => (await snapshot(request, id)).messages.filter((m) => m.role === 'assistant' && m.status === 'complete').length, { timeout: 60_000 }).toBe(answered + 1);
}

test('LX-0355-04 a new revision arriving while someone reads older chat moves neither pane', async ({ page, request }) => {
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'LX panes' } })).json();
  await say(request, made.id, 'make me 8 songs', null);
  await say(request, made.id, 'how many songs?', null);
  await say(request, made.id, 'which transitions are ready?', null);
  await page.setViewportSize({ width: 1500, height: 700 });
  await page.goto(`/mixes/lucy/${made.id}`);
  await expect(page.locator('main.lucy')).toHaveClass(/is-split/);
  await expect(page.locator('.lucy-msg')).toHaveCount(6);
  await expect(page.locator('.lucy-side').getByRole('button', { name: /^Revision 1/ })).toBeVisible();
  // reading back up in the chat, and part way down the proposal
  await page.evaluate(() => window.scrollTo(0, 0));
  const side = page.locator('.lucy-side');
  const sideTop = await side.evaluate((node) => { node.scrollTop = Math.min(120, node.scrollHeight - node.clientHeight); return node.scrollTop; });
  await page.waitForTimeout(300);
  const current = (await snapshot(request, made.id)).proposal!.current;
  await say(request, made.id, 'remove the second one', current.id);
  await expect(side.getByRole('button', { name: /^Revision 2/ })).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);
  expect(await side.evaluate((node) => node.scrollTop)).toBe(sideTop);
  await expect(page.getByRole('button', { name: /^New messages \(\d+\)$/ })).toBeVisible();
});

test('LX-0355-02 proposal, chat and actions sit in at most two framed boxes', async ({ page, request }) => {
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'LX frames' } })).json();
  await say(request, made.id, 'make me 6 songs', null);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(`/mixes/lucy/${made.id}`);
  await expect(page.locator('main.lucy')).toHaveClass(/is-split/);
  await expect(page.locator('.lucy-song').first()).toBeVisible();
  // a "frame" is any ancestor inside the page with a visible border on every side or a shadow
  const deepest = await page.evaluate(() => {
    const framed = (node: Element) => {
      const style = getComputedStyle(node);
      const sides = ['Top', 'Right', 'Bottom', 'Left'].every((side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0
        && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none');
      return sides || style.boxShadow !== 'none';
    };
    const main = document.querySelector('main.lucy')!;
    let worst = { depth: 0, what: '' };
    for (const node of main.querySelectorAll('.lucy-song, .lucy-msg, .lucy-approve button, .lucy-composer textarea')) {
      let depth = 0;
      for (let at = node.parentElement; at && at !== main; at = at.parentElement) if (framed(at)) depth += 1;
      if (depth > worst.depth) worst = { depth, what: node.className || node.tagName };
    }
    return worst;
  });
  expect(deepest.depth, `deepest framed item: ${deepest.what}`).toBeLessThanOrEqual(2);
});
