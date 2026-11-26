import { expect, Locator, Page, TestInfo } from '@playwright/test';

// The layout sweep (plan "two places", phase 1), shared by the local app's sweep
// (layout-sweep.e2e.ts) and Cloud's (e2e-cloud/layout-sweep.cloud.ts). Each surface is drawn at
// every width below and measured: nothing may scroll the page sideways, every element that pokes
// past the window's right edge without a box of its own that scrolls or clips it is named, at most
// one notice is open, and with cloud.page_layout on the page fills the frame or sits centred in it.
// A screenshot of each surface at each width is saved with the run, for a person to look at; none
// is compared.

/** Phones (320 and 390), a tablet, a laptop, a wide screen, a phone on its side, and a laptop with
 * its text at 200% (the root font size doubled, as a person who enlarges text sees it; every type
 * size is in rem). */
export const WIDTHS: readonly { width: number; height: number; name: string; text?: number }[] = [
  { width: 320, height: 640, name: '320' },
  { width: 390, height: 844, name: '390' },
  { width: 768, height: 1024, name: '768' },
  { width: 1280, height: 900, name: '1280' },
  { width: 1920, height: 1080, name: '1920' },
  { width: 844, height: 390, name: '844x390' },
  { width: 1280, height: 900, name: '1280-text200', text: 2 },
];

/** A title and a file name with no space to break at, the shape that pushes a page sideways. */
export const LONG_TITLE = 'Supercalifragilisticexpialidocious_Extended_Club_Mix_Remastered_2026_Final_Version_Three';
export const LONG_FILE = `${LONG_TITLE}_from_the_original_session_recordings.flac`;

/** `SELECTA_SWEEP_REPORT=1`: say what the sweep finds without failing, as its first run did. */
export const REPORT_ONLY = process.env.SELECTA_SWEEP_REPORT === '1';

export type Measured = {
  overflow: number;
  offenders: string[];
  expanded: number;
  frame: { ok: boolean; words: string } | null;
};

/** One look at the page as it is drawn now. `frame`: also check the page fills the frame (1400 px,
 * or the whole column when that is narrower) or is centred in it. */
export async function measure(page: Page, frame: boolean): Promise<Measured> {
  return page.evaluate((checkFrame) => {
    const room = window.innerWidth;
    const root = document.documentElement;
    const name = (element: Element) => {
      const classes = [...element.classList].slice(0, 3).map((one) => `.${one}`).join('');
      const words = (element.getAttribute('aria-label') || (element as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes}${words ? ` "${words}"` : ''}`;
    };
    // a box that scrolls or clips sideways holds what is inside it; the page itself never may
    const held = (element: Element) => {
      for (let up = element.parentElement; up && up !== document.body && up !== root; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (style.overflowX !== 'visible' || style.contain.includes('paint')) return true;
      }
      return false;
    };
    const out: Element[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      const box = element.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || box.right <= room + 1) continue;
      const style = getComputedStyle(element);
      // fixed things count too: a menu or a toast past the edge is cut off, though nothing scrolls
      if (style.visibility === 'hidden' || element.closest('[aria-hidden="true"], [inert]')) continue;
      if (!held(element)) out.push(element);
    }
    // the deepest ones say what is too wide; their boxes around them only follow
    const leaves = out.filter((element) => !out.some((other) => other !== element && element.contains(other)));
    let frameCheck: { ok: boolean; words: string } | null = null;
    if (checkFrame) {
      const content = document.querySelector('.content');
      const main = document.querySelector('.content > main.page');
      if (content && main) {
        const column = content.getBoundingClientRect();
        const inner = content.clientWidth;
        const page = main.getBoundingClientRect();
        const fills = Math.abs(page.width - Math.min(inner, 1400)) <= 2;
        const left = page.left - column.left;
        const right = column.left + inner - page.right;
        const centred = Math.abs(left - right) <= 2;
        frameCheck = { ok: fills || centred, words: `page ${Math.round(page.width)} px in a ${inner} px column, ${Math.round(left)} px left and ${Math.round(right)} px right` };
      }
    }
    return {
      overflow: root.scrollWidth - room,
      offenders: leaves.slice(0, 10).map((element) => `${name(element)} ends at ${Math.round(element.getBoundingClientRect().right)} px`),
      expanded: document.querySelectorAll('[data-notice-expanded]').length,
      frame: frameCheck,
    };
  }, frame);
}

/** Draw the surface open on `page` at every width, measure it and save a screenshot of each.
 * `prepare` runs at each width before measuring (to open a menu, say) and `after` once measured.
 * Returns what is wrong, one line per problem, empty when nothing is. */
export async function sweep(page: Page, testInfo: TestInfo, id: string, { frame = false, label = '', prepare, after }: { frame?: boolean; label?: string; prepare?: () => Promise<void>; after?: () => Promise<void> } = {}): Promise<string[]> {
  const problems: string[] = [];
  for (const view of WIDTHS) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await textScale(page, view.text ?? 0);
    // two frames for the layout to settle after the resize
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await prepare?.();
    const found = await measure(page, frame);
    const where = `${id}${label ? ` ${label}` : ''} at ${view.name}`;
    if (found.overflow > 0) problems.push(`${where}: the page scrolls sideways by ${found.overflow} px`);
    for (const offender of found.offenders) problems.push(`${where}: ${offender}`);
    if (found.expanded > 1) problems.push(`${where}: ${found.expanded} notices open at once`);
    if (found.frame && !found.frame.ok) problems.push(`${where}: neither fills the frame nor is centred in it (${found.frame.words})`);
    const shot = testInfo.outputPath(`${id.replace(/[^\w.-]+/g, '_')}${label ? `-${label}` : ''}-${view.name}.png`);
    await page.screenshot({ path: shot });
    await testInfo.attach(`${id}${label ? ` ${label}` : ''} ${view.name}`, { path: shot, contentType: 'image/png' });
    await after?.();
  }
  await textScale(page, 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  return problems;
}

/** The root font size as `scale` times the browser's (0: the browser's own). A page that has gone
 * away mid-sweep is left alone. */
async function textScale(page: Page, scale: number) {
  await page.evaluate((times) => { document.documentElement.style.fontSize = times ? `${times * 100}%` : ''; }, scale).catch(() => undefined);
}

/** One state of a surface to sweep: `open` runs at every width before it is measured (a drawer, a
 * menu, a held answer) and `close` once it is. Either may find nothing to press at some widths (a
 * phone's More, say); the surface is then measured as it is. */
export type SweepState = { name: string; open: () => Promise<void>; close?: () => Promise<void> };

/** Sweep each state in turn under `id`, as `sweep` does one. */
export async function sweepStates(page: Page, testInfo: TestInfo, id: string, states: SweepState[], options: { frame?: boolean; label?: string } = {}): Promise<string[]> {
  const problems: string[] = [];
  for (const state of states) {
    problems.push(...(await sweep(page, testInfo, `${id} ${state.name}`, { ...options, prepare: state.open, after: state.close })));
  }
  return problems;
}

/** Press the first visible match, if there is one; a state that cannot open here is measured shut. */
export async function pressIfThere(page: Page, selector: string | Locator) {
  const target = (typeof selector === 'string' ? page.locator(selector) : selector).first();
  if (!(await target.isVisible().catch(() => false))) return false;
  await target.click({ timeout: 5_000 }).catch(() => undefined);
  // the drawer or menu draws, and its arrival settles (reduced motion keeps this short)
  await page.waitForTimeout(250);
  return true;
}

/** Close whatever is open the way a person would: Escape, then a moment for it to leave. */
export async function escapeAll(page: Page) {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(200);
}

/** The drawers, sheets and menus every shell opens from its bars, each one a state: Requests, the
 * theme menu, Activity, search, the phone's More, and Cloud's account menu. */
export function barStates(page: Page): SweepState[] {
  const close = () => escapeAll(page);
  return [
    { name: 'requests drawer', open: async () => { await pressIfThere(page, page.getByRole('button', { name: /^Requests/ })); }, close },
    { name: 'theme menu', open: async () => { await pressIfThere(page, '.context-actions .theme-menu > button'); }, close },
    { name: 'activity', open: async () => { await pressIfThere(page, page.getByRole('button', { name: /^Activity/ })); }, close },
    { name: 'search', open: async () => { await pressIfThere(page, '.context-actions .palette-button'); }, close },
    { name: 'more sheet', open: async () => { await pressIfThere(page, 'button.nav-more-mobile'); }, close },
    { name: 'account menu', open: async () => { await pressIfThere(page, '.nav-account-button'); }, close },
  ];
}

/** Hold every answer to `pattern` until the test ends, so a page's loading state stays on screen. */
export async function holdAnswers(page: Page, pattern: string | RegExp) {
  await page.route(pattern, () => { /* never answered: the page waits, showing what it shows while loading */ });
}

/** Answer `pattern` with a server error, so a page shows its error state. */
export async function failAnswers(page: Page, pattern: string | RegExp, status = 500) {
  await page.route(pattern, (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'The sweep made this fail.', detail: 'The sweep made this fail.' }) }));
}

/** Report or enforce, as REPORT_ONLY says; the report always rides with the run. */
export async function verdict(testInfo: TestInfo, problems: string[]) {
  await testInfo.attach('layout problems', { body: problems.join('\n') || 'none', contentType: 'text/plain' });
  if (REPORT_ONLY) {
    if (problems.length) console.log(`[layout-sweep] ${testInfo.title}\n  ${problems.join('\n  ')}`);
    return;
  }
  expect(problems, 'layout problems').toEqual([]);
}
