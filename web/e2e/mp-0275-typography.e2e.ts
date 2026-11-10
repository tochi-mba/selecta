import { expect, test, type Browser, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * ADR-0275 typography, measured from the real stylesheet in Edge. Computed font metrics, line counts,
 * overflow, contrast and glyph rectangles at 320, 768 and 1440 (and at 200% and 400% page zoom).
 * Candidates for review, not a human visual approval.
 *
 * Song names: every name here is invented. The test server's library is renamed in flight (only the
 * JSON the page reads; nothing on disk changes), so this spec runs against the ordinary twelve-song
 * library and the SELECTA_E2E_STRESS one alike, and covers emoji and accents that the stress library
 * does not have. Roles: src/styles/tokens.css; numbers: src/styles/typography.css.
 */
const WIDTHS = [320, 768, 1440] as const;

// distinct from the SELECTA_E2E_STRESS names, so the two libraries can be used together
const UNBROKEN = 'Unbrokenmegatitlethatrunsonwithoutasinglespaceorhyphenanywhereinit' + 'Edit2026';
const CJK = '雨上がりの港で君を待ちながら静かに流れる夜の歌のとても長いタイトル';
const ARABIC = 'أغنية طويلة عن المطر والميناء والقمر والطريق إلى المدينة البعيدة';
const ARABIC_ARTIST = 'فرقة الليل الطويل التي تعزف حتى الفجر في المدينة القديمة';
const BIDI = 'Remix של לילה (feat. سلمى) 2025';
const SINGER = '\u{1F469}\u{1F3FD}‍\u{1F3A4}'; // woman singer, medium skin tone: one grapheme
const EMOJI = `Café Ñandú déjà vu ${SINGER}\u{1F3A7} «en vivo» ¿Qué tal?`;
const DECOMPOSED = 'Björk'; // o + combining diaeresis, not the precomposed ö
const ACCENT_ARTIST = `Zoë Ørsted & ${DECOMPOSED} Ångström`;
const SPACED = 'A Very Long Song Title That Keeps Going Well Past Any Reasonable Width For A Phone Screen (Extended Club Remix)';

const NAMES: Record<number, { title: string; artist: string }> = {
  1: { title: UNBROKEN, artist: 'Nospacesartistnamethatalsorefusestowrapanywhereatallreally' },
  2: { title: CJK, artist: '東京の夜の楽団と仲間たちと一緒に演奏する長い名前の人たち' },
  3: { title: ARABIC, artist: ARABIC_ARTIST },
  4: { title: BIDI, artist: 'Mixed Bidi Ensemble' },
  5: { title: EMOJI, artist: ACCENT_ARTIST },
  6: { title: SPACED, artist: 'An Ensemble With A Long And Thoroughly Descriptive Name That Goes On' },
};

/** Rename songs 1-6 in what the page reads: mix items, Library rows and song details. */
async function useNames(page: Page) {
  await page.route(/\/api\/(mix|library|songs\/\d+)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    if (!(response.headers()['content-type'] ?? '').includes('json')) return route.fulfill({ response });
    const rename = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rename);
      if (!value || typeof value !== 'object') return value;
      const record = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, rename(inner)]));
      const id = Number(record.song_id ?? record.id);
      if ('title' in record && 'artist' in record && NAMES[id]) Object.assign(record, NAMES[id]);
      return record;
    };
    await route.fulfill({ response, json: rename(await response.json()) });
  });
}

async function open(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
  await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 8_000 }).catch(() => null);
  await page.evaluate(() => document.fonts.ready);
}

async function theme(page: Page, chosen: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: chosen, reducedMotion: 'reduce' });
  await page.goto('/mixes');
  await page.evaluate((value) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: value, motion: 'still' })), chosen);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await useNames(page);
});

/** Size, weight, line height and family of the first visible match. */
async function metrics(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => {
    const css = getComputedStyle(element);
    return { size: Number.parseFloat(css.fontSize), weight: Number(css.fontWeight), line: css.lineHeight, family: css.fontFamily.split(',')[0], transform: css.textTransform };
  });
}

test('MP-0275-01 display, page, section, song title, metadata and caption are distinct roles', async ({ page, request }) => {
  await resetMix(request);
  await open(page, '/mixes');
  // the tokens themselves: every role resolves, and they step down in size
  const roles = await page.evaluate(() => {
    const probe = document.createElement('p');
    document.body.append(probe);
    const out = Object.fromEntries(['display', 'page', 'section', 'song', 'meta', 'label', 'caption', 'counter'].map((role) => {
      probe.style.font = '';
      probe.style.font = `var(--type-${role})`;
      const css = getComputedStyle(probe);
      return [role, { size: Number.parseFloat(css.fontSize), weight: Number(css.fontWeight), line: Number.parseFloat(css.lineHeight) / Number.parseFloat(css.fontSize), family: css.fontFamily.split(',')[0] }];
    }));
    probe.remove();
    return out;
  });
  expect(roles.display.size).toBeGreaterThan(roles.page.size);
  expect(roles.page.size).toBeGreaterThan(roles.section.size);
  expect(roles.section.size).toBeGreaterThan(roles.song.size);
  expect(roles.song.size).toBeGreaterThan(roles.meta.size);
  expect(roles.meta.size).toBeGreaterThan(roles.caption.size);
  expect(roles.label.weight).toBeGreaterThan(roles.caption.weight);
  expect(roles.counter.family).not.toBe(roles.meta.family);
  expect(roles.display.line).toBeCloseTo(1.08, 2); // the .display owner (MP-0275-02) uses this token
  const tuples = Object.values(roles).map((role) => `${role.size}/${role.weight}/${role.family}`);
  expect(new Set(tuples).size, tuples.join(' ')).toBe(tuples.length);

  // the roles as they render, at three widths
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/mixes');
    const display = await metrics(page, '.hero .display');
    const pageTitle = await metrics(page, 'h1.display.small');
    const section = await metrics(page, 'h2.section-title');
    const caption = await metrics(page, '.eyebrow');
    const label = await metrics(page, '.vibe-card .artists span');
    await open(page, '/library');
    const song = await metrics(page, '.library-rows .song-open b');
    const meta = await metrics(page, '.library-rows .song-name > span');
    const facts = await metrics(page, '.library-rows .song-columns');
    const where = `at ${width}px`;
    expect(display.size, where).toBeGreaterThan(pageTitle.size);
    expect(pageTitle.size, where).toBeGreaterThan(section.size);
    expect(section.size, where).toBeGreaterThan(song.size);
    expect(song.size, where).toBeGreaterThan(meta.size);
    expect(song.weight, where).toBeGreaterThan(meta.weight);
    expect(meta.size, where).toBeGreaterThanOrEqual(caption.size);
    expect(facts.size, where).toBeGreaterThanOrEqual(caption.size);
    // a caption is not just small metadata: its own face, weight and case
    expect(`${caption.family}/${caption.weight}/${caption.transform}`, where).not.toBe(`${meta.family}/${meta.weight}/${meta.transform}`);
    // the label role is defined: vibe cards asked for it and used to fall back to body text
    expect(label.size, where).toBe(roles.label.size);
    expect(label.weight, where).toBe(roles.label.weight);
    expect(display.family, where).toBe(pageTitle.family);
    expect(song.family, where).not.toBe(pageTitle.family);
  }
});

type TitleReading = { text: string; size: number; lines: number; clipped: boolean; inside: boolean; ellipsis: boolean };

async function readTitle(page: Page, selector: string): Promise<TitleReading> {
  return page.locator(selector).first().evaluate((element) => {
    const css = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines = new Set([...range.getClientRects()].filter((rect) => rect.width > 1).map((rect) => Math.round(rect.top + rect.height / 2))).size;
    let inside = true;
    for (let up = element.parentElement; up && up !== document.body; up = up.parentElement) {
      const style = getComputedStyle(up);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const outer = up.getBoundingClientRect();
      if (box.left < outer.left - 1 || box.right > outer.right + 1 || element.scrollWidth > outer.width + 1) inside = false;
    }
    return {
      text: (element.textContent ?? '').trim(),
      size: Number.parseFloat(css.fontSize),
      lines,
      // overflow only hides text when the box clips; a visible 2-3px glyph overhang is not clipping
      clipped: (css.overflowX !== 'visible' && element.scrollWidth > element.clientWidth + 1)
        || (css.overflowY !== 'visible' && element.scrollHeight > element.clientHeight + 1),
      inside,
      ellipsis: css.textOverflow === 'ellipsis' || css.webkitLineClamp !== 'none',
    };
  });
}

test('MP-0275-03 Listen, Stage and song details show complete focal titles at a readable size', async ({ page, request }) => {
  const report: string[] = [];
  for (const id of [1, 2, 3, 6]) {
    const { title } = NAMES[id];
    await resetMix(request, [id, 7]);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '/listen');
      const heading = page.locator('.listen-identity .track-title');
      await expect(heading).toHaveText(title);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      // the fit runs after layout; wait for it to settle
      await page.waitForTimeout(100);
      const listen = await readTitle(page, '.listen-identity .track-title');
      const where = `song ${id} on Listen at ${width}px`;
      expect(listen.text, where).toBe(title);
      expect(listen.clipped, `${where} is clipped`).toBe(false);
      expect(listen.inside, `${where} spills out of a clipping box`).toBe(true);
      expect(listen.ellipsis, where).toBe(false);
      expect(listen.size, `${where} was shrunk below the floor`).toBeGreaterThanOrEqual(24);
      // the transport is still on the first screen at desktop and tablet widths
      if (width >= 768) {
        const play = await page.locator('.now .transport .primary').boundingBox();
        expect(play!.y + play!.height, `${where}: Play pushed off the first screen`).toBeLessThanOrEqual(900);
      }
      report.push(`${where}: ${listen.size}px, ${listen.lines} lines`);

      if (width === 1440 || width === 320) {
        await page.keyboard.press('f');
        await expect(page.locator('.now.stage')).toBeVisible();
        await page.waitForTimeout(100);
        const stage = await readTitle(page, '.stage .listen-identity .track-title');
        expect(stage.text, `${where} on Stage`).toBe(title);
        expect(stage.clipped, `${where} on Stage is clipped`).toBe(false);
        expect(stage.inside, `${where} on Stage spills`).toBe(true);
        expect(stage.size, `${where} on Stage`).toBeGreaterThanOrEqual(24);
        report.push(`${where} Stage: ${stage.size}px, ${stage.lines} lines`);
        await page.keyboard.press('f');
        await expect(page.locator('.now.stage')).toHaveCount(0);
      }

      await open(page, '/library');
      await page.getByRole('button', { name: `Details for ${title}`, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
      const details = await readTitle(page, '.overlay-head h2');
      expect(details.text, `${where} in details`).toBe(title);
      expect(details.clipped, `${where} in details is clipped`).toBe(false);
      expect(details.inside, `${where} in details spills`).toBe(true);
      expect(details.ellipsis).toBe(false);
      expect(details.size).toBeGreaterThanOrEqual(16);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  }
  // the floor is a floor, not the size: a short title is still fitted large
  await resetMix(request, [4, 7]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/listen');
  await page.waitForTimeout(100);
  const short = await readTitle(page, '.listen-identity .track-title');
  expect(short.text).toBe(BIDI);
  expect(short.size, 'a short title was not fitted large').toBeGreaterThan(40);
  report.push(`song 4 on Listen at 1440px: ${short.size}px, ${short.lines} lines`);
  console.log('MP-0275-03 sizes', report.join('; '));
});

/** Every row element that is visually ellipsised right now. */
async function truncated(page: Page, rows: string) {
  return page.locator(rows).evaluateAll((list) => list.flatMap((row) => [...row.querySelectorAll<HTMLElement>('*')]
    .filter((element) => getComputedStyle(element).textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + 1 && element.getBoundingClientRect().width > 0)
    .map((element) => {
      const text = element.textContent ?? '';
      const box = element.getBoundingClientRect();
      // the first character of the name in its own reading order: is it inside the visible box?
      const range = document.createRange();
      const node = [...element.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.textContent);
      let firstVisible = true;
      if (node) {
        range.setStart(node, 0);
        range.setEnd(node, Math.min(2, node.textContent!.length));
        const first = range.getBoundingClientRect();
        firstVisible = first.left >= box.left - 1 && first.right <= box.right + 1;
      }
      return { text, title: element.getAttribute('title'), dir: getComputedStyle(element).direction, firstVisible, rowIndex: list.indexOf(row) };
    })));
}

test('MP-0275-04 Library and editor rows that ellipsise keep the whole identity accessible', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3, 4, 5, 6]);
  let found = 0;
  const all = Object.values(NAMES).flatMap((name) => [name.title, name.artist]);
  for (const density of ['comfortable', 'compact'] as const) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const [route, rows] of [['/library', '.library-rows .song-row'], ['/mix/current/edit', '.timeline .song']] as const) {
        await open(page, route);
        await page.evaluate((value) => { document.documentElement.dataset.density = value; }, density);
        for (const cut of await truncated(page, rows)) {
          const where = `"${cut.text.slice(0, 20)}" in ${route} at ${width}px, ${density}`;
          if (!all.includes(cut.text) && !/Unknown artist|Untitled/.test(cut.text)) continue;
          found += 1;
          // the whole name is still the element's text (read by assistive tech), and its tooltip
          expect(cut.title, `${where} has no full-name tooltip`).toBe(cut.text);
          // the start of the name is what stays visible, in either direction
          expect(cut.firstVisible, `${where} hides the start of the name`).toBe(true);
          if (cut.text === ARABIC_ARTIST) expect(cut.dir, where).toBe('rtl');
          const row = page.locator(rows).nth(cut.rowIndex);
          expect(await row.ariaSnapshot(), `${where} is missing from the accessibility tree`).toContain(cut.text.replace(/\s+/g, ' '));
        }
      }
    }
  }
  console.log('MP-0275-04 ellipsised names checked', found);
  expect(found, 'no row ellipsised anything, so nothing was proven').toBeGreaterThan(3);
  // the controls that act on a row name it in full, so a keyboard user hears the whole title
  await page.setViewportSize({ width: 320, height: 900 });
  await open(page, '/library');
  for (const { title } of Object.values(NAMES)) await expect(page.getByRole('button', { name: `Details for ${title}`, exact: true })).toHaveCount(1);
  await open(page, '/mix/current/edit');
  for (const { title } of Object.values(NAMES)) await expect(page.getByRole('button', { name: `Reorder ${title}`, exact: true })).toHaveCount(1);
});

/** Digits in this element's own font: does every digit take the same width? And are figures tabular? */
async function stableDigits(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toBeAttached();
  return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const css = getComputedStyle(element);
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
    element.append(probe);
    const widths = ['0000', '1111', '4444', '7777', '8888'].map((digits) => { probe.textContent = digits; return probe.getBoundingClientRect().width; });
    probe.remove();
    return { numeric: css.fontVariantNumeric, mono: /mono|consolas/i.test(css.fontFamily), spread: Math.max(...widths) - Math.min(...widths) };
  }));
}

const NUMBERS: Array<[string, string[]]> = [
  ['/listen', ['.strip .time', '.next-up .status', '.why .hint']],
  ['/library', ['.library-summary b', '.library-count', '.library-rows .song-columns span']],
  ['/mix/current/edit', ['.timeline .song .count', '.timeline .song .facts', '.editor-scope .status', '.mix-head .lede', '.scope-revision']],
  ['/mixes', ['.carry-on-words .soft', '.vibe-tempo', '.vibe-card-facts span', '.vibe-filters span']],
];

test('MP-0275-05 time, BPM, percentages and counts keep their width as they change', async ({ page, request }) => {
  await resetMix(request);
  let measured = 0;
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const [route, selectors] of NUMBERS) {
      await open(page, route);
      for (const selector of selectors) {
        const readings = await stableDigits(page, selector);
        expect(readings.length, `${selector} on ${route}`).toBeGreaterThan(0);
        for (const reading of readings) {
          expect(reading.numeric.includes('tabular-nums') || reading.mono, `${selector} on ${route} has proportional figures`).toBe(true);
          expect(reading.spread, `${selector} on ${route} at ${width}px: digits differ in width`).toBeLessThanOrEqual(0.5);
          measured += 1;
        }
      }
    }
    // song details: tempo, key, length and the beat grid's percentage
    await open(page, '/library');
    await page.getByRole('button', { name: `Details for ${NAMES[4].title}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    for (const reading of await stableDigits(page, '.song-facts dd')) {
      expect(reading.numeric).toContain('tabular-nums');
      expect(reading.spread).toBeLessThanOrEqual(0.5);
      measured += 1;
    }
    await page.keyboard.press('Escape');
  }
  expect(measured).toBeGreaterThan(60);

  // while it plays: the clock under the waveform, the countdown and the mini-player hold their width
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  const sample = async (selector: string) => page.locator(selector).first().evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return { text: element.textContent ?? '', width: Math.round(range.getBoundingClientRect().width * 10) / 10 };
  });
  const clock: Array<{ text: string; width: number }> = [];
  for (let tick = 0; tick < 6; tick += 1) {
    clock.push(await sample('.strip .time'));
    await page.waitForTimeout(700);
  }
  expect(new Set(clock.map((reading) => reading.text)).size, 'the clock did not move').toBeGreaterThan(2);
  expect(new Set(clock.map((reading) => reading.width)).size, JSON.stringify(clock)).toBe(1);
  for (const reading of await stableDigits(page, '.countdown-number strong, .countdown-meta')) expect(reading.spread).toBeLessThanOrEqual(0.5);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.locator('.mini')).toBeVisible();
  const mini = [];
  for (let tick = 0; tick < 5; tick += 1) {
    mini.push(await page.locator('.mini-song span').evaluate((element) => {
      // the clock is the run of text from the first n:nn to the end of the line
      const clock = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && /\d+:\d\d/.test(node.textContent!))!;
      const range = document.createRange();
      range.setStartBefore(clock);
      range.setEndAfter(element.lastChild!);
      return { text: range.toString(), width: Math.round(range.getBoundingClientRect().width * 10) / 10 };
    }));
    await page.waitForTimeout(700);
  }
  expect(new Set(mini.map((reading) => reading.text)).size, 'the mini-player clock did not move').toBeGreaterThan(2);
  expect(new Set(mini.map((reading) => reading.width)).size, JSON.stringify(mini)).toBe(1);
  await page.locator('.mini').getByRole('button', { name: 'Pause' }).click();
});

/** WCAG contrast of an element's text against what is actually behind it (gradients: every stop). */
async function contrast(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) => {
    const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (color: string) => {
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = '#000';
      canvas.fillStyle = color;
      canvas.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: number[], under: number[]) => top.slice(0, 3).map((value, index) => value * top[3] + under[index] * (1 - top[3])).concat(1);
    const luminance = (color: number[]) => {
      const [r, g, b] = color.slice(0, 3).map((value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (one: number[], two: number[]) => { const [a, b] = [luminance(one), luminance(two)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
    const root = getComputedStyle(document.documentElement);
    return elements.filter((element) => element.getBoundingClientRect().width > 0 && (element.textContent ?? '').trim()).map((element) => {
      const layers: string[] = [];
      let gradient = false;
      for (let up: Element | null = element; up; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (style.backgroundImage !== 'none' && style.backgroundImage.includes('gradient')) gradient = true;
        layers.push(style.backgroundColor);
        if (rgba(style.backgroundColor)[3] === 1) break;
      }
      const base = (bottom: number[]) => layers.reverse().reduce((under, layer) => over(rgba(layer), under), bottom);
      const page = rgba(getComputedStyle(document.body).backgroundColor);
      const behind = [base(page)];
      // a gradient sleeve runs between the raised and plain surfaces, tinted by the selection colour
      if (gradient) for (const name of ['--surface-raised', '--surface']) behind.push(rgba(root.getPropertyValue(name)));
      let opacity = 1;
      for (let up: Element | null = element; up; up = up.parentElement) opacity *= Number(getComputedStyle(up).opacity);
      const text = rgba(getComputedStyle(element).color);
      const worst = Math.min(...behind.map((back) => ratio(over([...text.slice(0, 3), text[3] * opacity], back), back)));
      return { text: (element.textContent ?? '').trim().slice(0, 24), ratio: Math.round(worst * 100) / 100, size: Number.parseFloat(getComputedStyle(element).fontSize), weight: Number(getComputedStyle(element).fontWeight) };
    });
  });
}

const SECONDARY: Array<[string, string, string[]]> = [
  ['/library', '.library-rows .song-open b', ['.library-rows .song-name > span', '.library-rows .song-columns', '.library-rows .song-readiness .status', '.library-rows .song-why', '.library-summary span']],
  ['/mix/current/edit', '.timeline .song-select b', ['.timeline .song-name > span', '.timeline .song .facts', '.timeline .song .count', '.editor-scope .scope-words']],
  ['/listen', '.listen-identity .track-title', ['.listen-identity .artist', '.listen-identity .eyebrow', '.next-song span', '.transition-truth .status']],
];

test('MP-0275-06 artist and readiness labels are quieter than titles but keep 4.5:1 contrast', async ({ page, request }) => {
  await resetMix(request, [3, 5, 1, 2]);
  const lowest: Record<string, number> = {};
  for (const chosen of ['light', 'dark'] as const) {
    await theme(page, chosen);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const [route, primary, secondary] of SECONDARY) {
        await open(page, route);
        const [title] = await contrast(page, primary);
        expect(title, `${primary} on ${route}`).toBeDefined();
        const titleWeight = title.weight;
        for (const selector of secondary) {
          const readings = await contrast(page, selector);
          expect(readings.length, `${selector} on ${route} at ${width}px`).toBeGreaterThan(0);
          for (const reading of readings) {
            const where = `${selector} "${reading.text}" on ${route} at ${width}px, ${chosen}`;
            expect(reading.ratio, `${where} is below 4.5:1`).toBeGreaterThanOrEqual(4.5);
            // quieter: less contrast than the title, or smaller and lighter
            const quieter = reading.ratio < title.ratio - 0.5 || (reading.size < title.size && reading.weight < titleWeight);
            expect(quieter, `${where} is as loud as the title (${reading.ratio} vs ${title.ratio})`).toBe(true);
            lowest[`${chosen} ${selector}`] = Math.min(lowest[`${chosen} ${selector}`] ?? 99, reading.ratio);
          }
        }
      }
    }
  }
  console.log('MP-0275-06 lowest contrast', JSON.stringify(lowest));
});

/** Text cut off by a clipping box (not a deliberate, accessible ellipsis) and controls covered by something else. */
async function zoomDefects(page: Page) {
  return page.evaluate(() => {
    const defects: string[] = [];
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return false;
      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && !element.closest('.visually-hidden, [hidden], details:not([open]) > :not(summary)');
    };
    const name = (element: Element) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} "${(element.textContent ?? '').trim().slice(0, 24)}"`;
    const texts = [...document.querySelectorAll('main *, .mini *, .context-bar *, nav *')].filter((element) =>
      [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim()) && visible(element));
    for (const element of texts) {
      const style = getComputedStyle(element);
      const deliberate = style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none';
      if (!deliberate && style.overflowX !== 'visible' && style.overflowX !== 'auto' && style.overflowX !== 'scroll' && element.scrollWidth > element.clientWidth + 1) defects.push(`clipped ${name(element)}`);
      const box = element.getBoundingClientRect();
      for (let up = element.parentElement; up && up !== document.body; up = up.parentElement) {
        const outer = getComputedStyle(up);
        if (outer.overflowX !== 'hidden' && outer.overflowX !== 'clip') continue;
        if (up.closest('.sections, .visually-hidden')) break; // waveform section labels are cut by design
        const edge = up.getBoundingClientRect();
        if (!deliberate && (box.right > edge.right + 1 || box.left < edge.left - 1)) defects.push(`cut by ${name(up)}: ${name(element)}`);
        break;
      }
    }
    return { defects, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
}

/** Scroll each control into view and ask the page what is under its middle. */
async function coveredControls(page: Page) {
  return page.evaluate(async () => {
    const covered: string[] = [];
    const controls = [...document.querySelectorAll<HTMLElement>('main button, main a[href], main input:not([type="hidden"]), main select, main summary')]
      .filter((element) => { const box = element.getBoundingClientRect(); return box.width >= 2 && box.height >= 2 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('.visually-hidden, details:not([open]) > :not(summary)'); })
      .slice(0, 50);
    for (const control of controls) {
      control.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const box = control.getBoundingClientRect();
      const points = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]].map(([x, y]) => [box.left + box.width * x, box.top + box.height * y]);
      const reachable = points.some(([x, y]) => {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && (control.contains(hit) || hit.contains(control) || !!hit.closest('label')?.contains(control));
      });
      if (!reachable) covered.push(`${control.tagName.toLowerCase()} "${(control.getAttribute('aria-label') ?? control.textContent ?? '').trim().slice(0, 30)}"`);
    }
    window.scrollTo(0, 0);
    return covered;
  });
}

async function zoomed(browser: Browser, baseURL: string | undefined, zoom: number) {
  // Browser zoom on a 1280x900 window: the CSS viewport shrinks by the zoom and each CSS pixel gets
  // zoom device pixels. 200% is 640x450, 400% is 320x225 (the WCAG 1.4.10 reflow width).
  const context = await browser.newContext({ baseURL, viewport: { width: 1280 / zoom, height: 900 / zoom }, deviceScaleFactor: zoom, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await useNames(page);
  return { context, page };
}

for (const zoom of [2, 4]) {
  test(`MP-0275-07 at ${zoom * 100}% zoom no text is clipped and key controls stay reachable`, async ({ browser, baseURL, request }) => {
    await resetMix(request, [1, 2, 3, 5]);
    const { context, page } = await zoomed(browser, baseURL, zoom);
    const width = 1280 / zoom;
    for (const route of ['/listen', '/library', '/mix/current/edit', '/mixes', '/mixes/mine']) {
      await open(page, route);
      const found = await zoomDefects(page);
      expect(found.overflow, `${route} scrolls sideways at ${zoom * 100}%`).toBeLessThanOrEqual(1);
      expect(found.defects, `${route} at ${zoom * 100}% (${width}px)`).toEqual([]);
      expect(await coveredControls(page), `${route} controls covered at ${zoom * 100}%`).toEqual([]);
    }
    // a dialog at zoom: the song's name and its actions
    await open(page, '/library');
    await page.getByRole('button', { name: `Details for ${UNBROKEN}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    const title = await readTitle(page, '.overlay-head h2');
    expect(title.text).toBe(UNBROKEN);
    expect(title.clipped).toBe(false);
    expect(title.inside).toBe(true);
    const close = dialog.getByRole('button', { name: /Close/ }).first();
    await expect(close).toBeInViewport();
    await context.close();
  });
}

/** Glyph boxes for parts of a name inside an element. */
async function glyphs(page: Page, selector: string, parts: string[]) {
  return page.locator(selector).first().evaluate((element, wanted) => {
    const node = [...element.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim()) as Text;
    const css = getComputedStyle(element);
    const em = Number.parseFloat(css.fontSize);
    const boxes = Object.fromEntries(wanted.map((part) => {
      const at = node.data.indexOf(part);
      if (at < 0) return [part, null];
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + part.length);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
      const box = range.getBoundingClientRect();
      return [part, { left: box.left, right: box.right, top: Math.round(box.top), width: box.width, lines: new Set(rects.map((rect) => Math.round(rect.top))).size }];
    }));
    return { text: node.data, em, direction: css.direction, unicodeBidi: css.unicodeBidi, overflow: element.scrollWidth - element.clientWidth, boxes };
  }, parts);
}

type Glyph = { left: number; right: number; top: number };
/** The first word of a right-to-left name sits right of (or on a line above) its last word. */
function expectRightToLeft(first: Glyph, last: Glyph, where: string) {
  expect(first.right, `${where}: the name does not start on the right`).toBeGreaterThanOrEqual(last.right - 1);
  if (first.top === last.top) expect(first.left, `${where}: words run left to right`).toBeGreaterThan(last.right - 1);
  else expect(first.top, where).toBeLessThan(last.top);
}

test('MP-0275-08 RTL, CJK, emoji, accents and mixed-script punctuation keep their meaning', async ({ page, request }) => {
  await resetMix(request, [5, 4, 3, 2]);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/library');
    const row = (title: string) => `.library-rows .song-row:has(button[aria-label="Details for ${title}"])`;
    const where = `at ${width}px`;

    // the exact characters arrive: decomposed accents stay decomposed, emoji stay whole
    const emoji = await glyphs(page, `${row(EMOJI)} .song-open b`, [SINGER, 'é', '«en vivo»', '¿Qué tal?']);
    expect(emoji.text, where).toBe(EMOJI);
    expect(emoji.boxes[SINGER]!.lines, `${where}: the singer emoji split across lines`).toBe(1);
    expect(emoji.boxes[SINGER]!.width, `${where}: the singer emoji drew as several glyphs`).toBeLessThan(emoji.em * 1.9);
    expect(emoji.boxes['«en vivo»']!.lines, where).toBe(1);
    expect(emoji.boxes['¿Qué tal?']!.left).toBeLessThan(emoji.boxes['¿Qué tal?']!.right);
    const accent = await glyphs(page, `${row(EMOJI)} .song-name > span`, [DECOMPOSED, 'ö', 'Zoë']);
    expect(accent.text, where).toBe(ACCENT_ARTIST);
    expect(accent.text.normalize('NFC'), 'the decomposed accent was normalised away').not.toBe(accent.text);
    if (accent.boxes['ö']) expect(accent.boxes['ö']!.width, `${where}: the diaeresis took its own space`).toBeLessThan(accent.em * 0.9);

    // a mixed Latin, Hebrew and Arabic name: Latin first, so it reads left to right, with the
    // parenthesis still wrapping the Arabic credit and the year at the end
    const bidi = await glyphs(page, `${row(BIDI)} .song-open b`, ['Remix', 'feat.', 'سلمى', '2025', '(', ')']);
    expect(bidi.text).toBe(BIDI);
    expect(bidi.direction, where).toBe('ltr');
    const b = bidi.boxes as Record<string, { left: number; right: number }>;
    if (bidi.overflow <= 1 && width >= 768) {
      expect(b.Remix.left, where).toBeLessThan(b['feat.'].left);
      expect(b['('].right, where).toBeLessThanOrEqual(b['feat.'].left + 1);
      expect(b[')'].left, where).toBeGreaterThanOrEqual(b['سلمى'].right - 1);
      expect(b['2025'].left, where).toBeGreaterThan(b[')'].left);
    }

    // Arabic resolves right to left on its own element: its first word is on the right
    const arabic = await glyphs(page, `${row(ARABIC)} .song-open b`, ['أغنية', 'البعيدة']);
    expect(arabic.direction, where).toBe('rtl');
    expect(arabic.overflow, where).toBeLessThanOrEqual(1);
    expectRightToLeft(arabic.boxes['أغنية']!, arabic.boxes['البعيدة']!, where);

    // CJK has no spaces: it wraps between characters inside its box, and every character has a glyph
    const cjk = await glyphs(page, `${row(CJK)} .song-open b`, [...'雨上がりの港']);
    expect(cjk.text).toBe(CJK);
    expect(cjk.overflow, `${where}: CJK title overflows`).toBeLessThanOrEqual(1);
    for (const char of '雨上がりの港') expect(cjk.boxes[char]!.width, `${where}: ${char} has no glyph`).toBeGreaterThan(cjk.em * 0.6);
  }

  // the same names on Listen, the editor and in details: text and direction survive every surface
  await page.setViewportSize({ width: 768, height: 900 });
  await open(page, '/listen');
  const listen = await glyphs(page, '.listen-identity .track-title', [SINGER]);
  expect(listen.text).toBe(EMOJI);
  expect(listen.boxes[SINGER]!.lines).toBe(1);
  await expect(page.locator('.listen-identity .artist')).toHaveText(ACCENT_ARTIST);
  await open(page, '/mix/current/edit');
  for (const id of [5, 4, 3, 2]) await expect(page.locator('.timeline .song-select b', { hasText: NAMES[id].title.slice(0, 8) })).toHaveText(NAMES[id].title);
  const rtl = await page.locator('.timeline .song-name > span', { hasText: ARABIC_ARTIST }).evaluate((element) => getComputedStyle(element).direction);
  expect(rtl).toBe('rtl');
  await open(page, '/library');
  await page.getByRole('button', { name: `Details for ${ARABIC}`, exact: true }).click();
  const heading = await glyphs(page, '.overlay-head h2', ['أغنية', 'البعيدة']);
  expect(heading.text).toBe(ARABIC);
  expect(heading.unicodeBidi).toBe('plaintext');
  expectRightToLeft(heading.boxes['أغنية']!, heading.boxes['البعيدة']!, 'song details title');
  await expect(page.locator('.song-detail-artist')).toHaveText(ARABIC_ARTIST);
});
