import { writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { resetMix } from './helpers';
import { contrastOf, kitSource, limeUses, overlayDepth, panelNoise, radii, separators, stateCues, surfaceRoles, type Rgba } from './depth-measure';

/**
 * ADR-0276 surface depth, borders, shadows and accent hierarchy, measured from the real stylesheet in
 * Edge against the synthetic library in tests/e2e_server.py, in Light and Dark at 320, 768 and 1440.
 * Candidates for an independent reviewer, not a human visual approval. Measuring: e2e/depth-measure.ts.
 */
const WIDTHS = [320, 768, 1440] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const ROUTES = ['/mixes', '/library', '/mixes/mine', '/workshop', '/discover', '/mix/current/edit', '/listen', '/listening'] as const;

/** Run a measuring function from depth-measure.ts, with its shared kit loaded into the page first. */
async function measure<A, R>(page: Page, fn: (arg: A) => R, arg: A): Promise<R> {
  await page.evaluate((source) => { (window as unknown as { __depthKit: string }).__depthKit = source; }, kitSource);
  return page.evaluate(fn as never, arg as never) as Promise<R>;
}

async function settle(page: Page) {
  await expect(page.locator('main#main')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

/** The theme is chosen the way a person chooses it: the OS setting, and Selecta's own preference. */
async function useTheme(page: Page, theme: Theme | 'system', os: Theme) {
  await page.emulateMedia({ colorScheme: os, reducedMotion: 'reduce' });
  await page.goto('/mixes');
  await page.evaluate((chosen) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })), theme);
}

async function open(page: Page, route: string, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(route);
  await settle(page);
}

/** A candidate record for the reviewer, beside the run's other output; nothing in it judges how it looks. */
function record(info: TestInfo, key: string, value: unknown) {
  writeFileSync(info.outputPath(`mp-0276-${key}.json`), JSON.stringify({ status: 'candidate-not-independently-verified', value }, null, 1));
}

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

for (const theme of THEMES) {
  test(`MP-0276-01 base, raised, control, panel and overlay each paint their own role (${theme})`, async ({ page }, info) => {
    await useTheme(page, theme, theme);
    const readings = [];
    for (const width of WIDTHS) {
      await open(page, '/mixes', width);
      const mixes = await measure(page, surfaceRoles, {
        base: 'body', raised: '.vibe-card, .card', control: 'main button:not(.primary):not([aria-pressed="true"]):not(.quiet):not(.link)', panel: 'nav.nav',
      });
      const { roles } = mixes;
      const where = `/mixes ${theme} ${width}px`;
      // the roles themselves are distinct where they meet: page, card, button, scrim and overlay
      expect(roles['--surface-base'], where).not.toEqual(roles['--surface-raised']);
      expect(roles['--surface-raised'], where).not.toEqual(roles['--surface-control']);
      expect(roles['--surface-base'], where).not.toEqual(roles['--surface-control']);
      expect(roles['--surface-overlay'], where).not.toEqual(roles['--surface-base']);
      expect(roles['--surface-scrim'][3], `${where}: the scrim dims but never hides the page`).toBeGreaterThan(0.4);
      expect(roles['--surface-scrim'][3], where).toBeLessThan(1);
      // and each real surface paints the role that names it
      expect(mixes.painted.base, `${where}: page`).toEqual(roles['--surface-base']);
      expect(mixes.painted.raised, `${where}: idea card`).toEqual(roles['--surface-raised']);
      expect(mixes.painted.control, `${where}: button`).toEqual(roles['--surface-control']);
      expect(mixes.painted.panel, `${where}: rail or tab bar`).toEqual(roles['--surface-panel']);

      await open(page, '/library', width);
      const library = await measure(page, surfaceRoles, { field: 'input[type="search"]' });
      expect(library.painted.field, `/library ${width}px: a field is a place to write, on the raised surface`).toEqual(roles['--surface-raised']);
      await page.getByRole('button', { name: /^Details for / }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await settle(page);
      const dialog = await measure(page, surfaceRoles, { scrim: '.overlay', overlay: '.overlay-panel' });
      expect(dialog.painted.scrim, `${where}: scrim`).toEqual(roles['--surface-scrim']);
      expect(dialog.painted.overlay, `${where}: dialog`).toEqual(roles['--surface-overlay']);
      await page.keyboard.press('Escape');
      readings.push({ width, ...mixes, library: library.painted, dialog: dialog.painted });
    }
    // Dark lifts an overlay lighter than a card, since a shadow can't be seen on near-black
    const { roles } = readings[0];
    const sum = (colour: Rgba) => colour[0] + colour[1] + colour[2];
    if (theme === 'dark') expect(sum(roles['--surface-overlay'])).toBeGreaterThan(sum(roles['--surface-raised']));
    else expect(sum(roles['--surface-overlay'])).toBeGreaterThanOrEqual(sum(roles['--surface-raised']));
    record(info, `01-${theme}`, readings);
  });

  test(`MP-0276-02 no frame sits inside a frame of its own colour, and only overlays float (${theme})`, async ({ page }, info) => {
    await useTheme(page, theme, theme);
    const readings = [];
    let frames = 0;
    for (const width of WIDTHS) {
      for (const route of ROUTES) {
        await open(page, route, width);
        const noise = await measure(page, panelNoise, undefined);
        expect(noise.nested, `${route} ${width}px: a box inside a box of the same colour`).toEqual([]);
        expect(noise.triple, `${route} ${width}px: border, fill and a drop shadow at rest`).toEqual([]);
        frames += noise.frames;
        readings.push({ route, width, ...noise });
      }
      // the editor with its inspector open, and a drawer with a panel inside it
      await open(page, '/mix/current/edit', width);
      await page.getByRole('button', { name: 'Change', exact: true }).first().click();
      await expect(page.locator('.inspector-identity')).toBeVisible();
      const inspector = await measure(page, panelNoise, undefined);
      expect(inspector.nested, `inspector ${width}px`).toEqual([]);
      expect(inspector.triple, `inspector ${width}px`).toEqual([]);
      await open(page, '/library', width);
      await page.keyboard.press('r');
      await expect(page.getByRole('dialog', { name: 'Requests' })).toBeVisible();
      const drawer = await measure(page, panelNoise, undefined);
      expect(drawer.nested, `requests drawer ${width}px`).toEqual([]);
      expect(drawer.triple, `requests drawer ${width}px`).toEqual([]);
      readings.push({ route: 'inspector', width, ...inspector }, { route: 'requests drawer', width, ...drawer });
    }
    expect(frames, 'framed surfaces measured').toBeGreaterThan(20);
    record(info, `02-${theme}`, readings);
  });

  test(`MP-0276-03 corners and line weights follow component roles (${theme})`, async ({ page }, info) => {
    await useTheme(page, theme, theme);
    const ROLES = {
      card: '.card, .panel, .carry-on, .timeline .song, .edit-inspector, .vibe-card, .handoff, .requests',
      field: 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select',
      pill: '.pill, .request-tag, .story-tag, .status-pill',
      overlay: '.overlay-dialog .overlay-panel, .menu-list',
    };
    // the token scale: hair 2, mark 4, sm 8, radius 10, the Listen hero 15, pill 99, round 50%, the drawn word tie 40%
    const SCALE = ['0px', '2px', '4px', '8px', '10px', '15px', '99px', '50%', '40%'];
    const readings = [];
    for (const width of WIDTHS) {
      for (const route of ROUTES) {
        await open(page, route, width);
        const reading = await measure(page, radii, ROLES);
        const off = Object.keys(reading.used).filter((value) => !SCALE.includes(value));
        expect(off.map((value) => `${value}: ${reading.used[value].join(' ')}`), `${route} ${width}px: a corner off the role scale`).toEqual([]);
        for (const value of reading.byRole.card) expect(value, `${route} ${width}px card`).toBe('10px');
        for (const value of reading.byRole.field) expect(value, `${route} ${width}px field`).toBe('8px');
        for (const value of reading.byRole.pill) expect(value, `${route} ${width}px pill`).toBe('99px');
        readings.push({ route, width, ...reading });
      }
      await open(page, '/library', width);
      await page.locator('.theme-menu > button').first().click();
      await expect(page.locator('.menu-list').first()).toBeVisible();
      const menu = await measure(page, radii, ROLES);
      for (const value of menu.byRole.overlay) expect(value, `menu ${width}px`).toBe('8px');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Details for / }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const dialog = await measure(page, overlayDepth, ['.overlay-panel', true] as const);
      // a phone sheet rounds only its top corners, which start at the radius too
      expect(dialog!.radius, `dialog ${width}px`).toBe('10px');
      await page.keyboard.press('Escape');
    }
    // line weights: separators 1px, state markers 3px, focus 2px or more (measured in MP-0276-07);
    // here, the marker bars every state shares
    await open(page, '/mix/current/edit', 1440);
    await page.getByRole('button', { name: 'Change', exact: true }).first().click();
    const selected = await measure(page, stateCues, '.timeline .song.selected, .editor-scope.is-current');
    for (const cue of selected.filter((item) => item.bar)) expect(cue.bar, cue.name).toBe(3);
    record(info, `03-${theme}`, readings.map(({ route, width, used }) => ({ route, width, values: Object.keys(used) })));
  });
}

test('MP-0276-04 pure lime only marks a main action, focus, selection, playing or work in progress', async ({ page }, info) => {
  // In Light, lime is only ever the main action's fill (tokens.css), so Dark is where it could spread
  const MEANING = [
    '.primary', 'a', '.link', '[aria-pressed="true"]', '[aria-current]:not([aria-current="false"])', '[aria-selected="true"]',
    '[aria-checked="true"]', '.choice:has(input:checked)', '.view-switch-option:has(input:checked)', ':focus-visible', ':focus',
    '.selected', '.is-selected', '.playing', '.is-current', '.in-seam', '.over', '.open', '.carry-on.prominent',
    '.now .display', '.chord-strip .now', '.studio-ruler .now', '.studio-cell.now', '.rendering', '.queued', '.status-working',
    '.status-needs-action', '.request-attention', '.attention', '.current-word', '.mini-progress', '.seam-mark', '.handoff.active',
    '.handoff-progress', '.beat-pips', '.countdown-track', '.skip-link', '.setup-steps [aria-current]', '.wanted', '.pending-line',
  ].join(', ');
  const readings = [];
  for (const theme of THEMES) {
    await useTheme(page, theme, theme);
    for (const width of WIDTHS) {
      for (const route of ROUTES) {
        await open(page, route, width);
        const reading = await measure(page, limeUses, MEANING);
        const where = `${route} ${theme} ${width}px`;
        expect(reading.uses.filter((use) => !use.meaningful).map((use) => `${use.how} ${use.name}`), `${where}: decorative lime`).toEqual([]);
        // lime fills are a few small actions, never a wash
        expect(reading.filledShare, `${where}: lime fill share`).toBeLessThan(0.06);
        expect(reading.motif, 'motifs use their own quieter colour').not.toEqual(reading.lime);
        if (theme === 'light') expect(reading.uses.filter((use) => use.how !== 'fill' && !use.name.includes('primary')).map((use) => use.name), `${where}: lime as a line or words on cream`).toEqual([]);
        readings.push({ route, theme, width, share: Math.round(reading.filledShare * 10000) / 100, uses: reading.uses.map((use) => `${use.how} ${use.name}`) });
      }
    }
  }
  record(info, '04', readings);
});

for (const theme of THEMES) {
  test(`MP-0276-05 requests, warnings, focus and playback each carry words and a non-colour cue (${theme})`, async ({ page, request }, info) => {
    await useTheme(page, theme, theme);
    const readings = [];
    // a request of our own, cleared again at the end
    for (const row of ((await (await request.get('/api/requests')).json()).requests as { id: number; title: string }[]).filter((item) => item.title === 'Last Call')) {
      await request.delete(`/api/requests/${row.id}`);
    }
    for (const width of WIDTHS) {
      const where = `${theme} ${width}px`;
      // warnings: Library recordings that need attention
      await open(page, '/library', width);
      await page.getByRole('group', { name: 'Filter Library recordings' }).getByRole('button', { name: /attention/i }).click();
      await expect(page.getByRole('button', { name: 'Details for Broken File' })).toBeVisible();
      const warnings = (await measure(page, stateCues, '.library-rows :is(.status-warning, .status-failed, .status-blocked)'));
      expect(warnings.length, `${where}: warnings shown`).toBeGreaterThan(0);
      for (const cue of warnings) {
        expect(cue.icon, `${where}: ${cue.text} has a mark`).toBe(true);
        expect(cue.text.length, `${where}: warning words`).toBeGreaterThan(2);
        expect(await page.evaluate(contrastOf, [cue.colour, cue.ground] as [Rgba, Rgba]), `${where}: ${cue.text} reads`).toBeGreaterThanOrEqual(3);
      }

      // requests: the request's own row in the drawer
      await page.keyboard.press('r');
      const drawer = page.getByRole('dialog', { name: 'Requests' });
      if (width === WIDTHS[0]) {
        await drawer.getByRole('combobox', { name: 'Request a song' }).fill('Last Call');
        await drawer.getByRole('button', { name: /Last Call/ }).first().click();
      }
      const yours = drawer.getByRole('list', { name: 'Your requests' });
      await expect(yours.getByText('Last Call')).toBeVisible();
      const requests = await measure(page, stateCues, '.request-row');
      const asked = requests.find((cue) => cue.text.includes('Last Call'))!;
      expect(asked.bar, `${where}: request marker bar`).toBe(3);
      const pill = await measure(page, stateCues, '.request-row .pill');
      expect(pill.some((cue) => /Requested|Waiting|Finding|Getting ready|Needs|Ready/.test(cue.text)), `${where}: request words`).toBe(true);
      await page.keyboard.press('Escape');

      // focus: a ring, not only a colour, after a keyboard move
      await open(page, '/mix/current/edit', width);
      await page.keyboard.press('Tab');
      await page.locator('.timeline .song-select').first().focus();
      const ring = await measure(page, stateCues, '.timeline .song-select:focus-visible');
      expect(ring[0].outlineStyle, `${where}: focus ring`).toBe('solid');
      expect(ring[0].outline, `${where}: focus ring width`).toBeGreaterThanOrEqual(2);

      // playback: the playing song says so, beside its marker bar
      if (width === WIDTHS[0]) await page.getByRole('button', { name: /^Play from / }).first().click();
      await expect(page.locator('.timeline .song.playing')).toHaveCount(1, { timeout: 60_000 });
      const playing = (await measure(page, stateCues, '.timeline .song.playing'))[0];
      const resting = (await measure(page, stateCues, '.timeline .song:not(.playing)'))[0];
      expect(playing.text, `${where}: playing words`).toContain('Playing now');
      expect(playing.startBorder, `${where}: playing bar`).toBe(3);
      expect(resting.startBorder, `${where}: a resting row has only its hairline`).toBe(1);
      // focus and playing share lime in Dark, so their shapes differ: a ring round, a bar down one side
      expect(ring[0].outline).not.toBe(0);
      expect(playing.outline).toBe(0);
      // and the status hues themselves are told apart
      const hues = await page.evaluate(() => Object.fromEntries(['--status-request', '--status-warning', '--playing', '--status-ready'].map((name) => {
        const probe = document.createElement('i');
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return [name, value];
      })));
      expect(new Set(Object.values(hues)).size, `${where}: request, warning, playing and ready hues`).toBe(4);
      readings.push({ width, warnings: warnings.map((cue) => cue.text), request: asked, pill: pill.map((cue) => cue.text), ring: ring[0], playing, hues });
    }
    await page.getByRole('button', { name: 'Pause' }).first().click().catch(() => undefined);
    for (const row of ((await (await request.get('/api/requests')).json()).requests as { id: number; title: string }[]).filter((item) => item.title === 'Last Call')) {
      await request.delete(`/api/requests/${row.id}`);
    }
    record(info, `05-${theme}`, readings);
  });

  test(`MP-0276-06 overlay depth stays gentle and can be seen (${theme})`, async ({ page }, info) => {
    await useTheme(page, theme, theme);
    const readings = [];
    for (const width of WIDTHS) {
      await open(page, '/library', width);
      const checks: Array<[string, () => Promise<void>, string, boolean]> = [
        ['song details', async () => { await page.getByRole('button', { name: /^Details for / }).first().click(); await expect(page.getByRole('dialog')).toBeVisible(); }, '.overlay-panel', true],
        ['requests drawer', async () => { await page.keyboard.press('r'); await expect(page.getByRole('dialog', { name: 'Requests' })).toBeVisible(); }, '.overlay-panel', true],
        ['theme menu', async () => { await page.locator('.theme-menu > button').first().click(); await expect(page.locator('.menu-list').first()).toBeVisible(); }, '.menu-list', false],
      ];
      for (const [label, show, selector, scrim] of checks) {
        await show();
        await settle(page);
        const depth = (await measure(page, overlayDepth, [selector, scrim] as const))!;
        const where = `${label} ${theme} ${width}px`;
        const drop = depth.shadows.filter((layer) => !layer.inset);
        expect(drop.length, `${where}: has depth`).toBeGreaterThan(0);
        for (const layer of drop) {
          // gentle: soft and short, never a hard dark slab
          expect(layer.colour[3], `${where}: shadow strength`).toBeLessThanOrEqual(0.45);
          expect(layer.y, `${where}: shadow drop`).toBeLessThanOrEqual(16);
          expect(layer.blur, `${where}: shadow blur`).toBeLessThanOrEqual(40);
        }
        expect(Math.max(...drop.map((layer) => layer.blur)), `${where}: a soft layer`).toBeGreaterThanOrEqual(16);
        // perceivable: its edge stands off the dimmed page in both themes
        expect(depth.edgeWidth, `${where}: edge`).toBeGreaterThanOrEqual(1);
        expect(depth.edgeContrast, `${where}: edge against the page`).toBeGreaterThanOrEqual(2);
        if (theme === 'dark') expect(depth.surfaceContrast, `${where}: lifted surface`).toBeGreaterThan(1.1);
        readings.push({ label, width, ...depth });
        await page.keyboard.press('Escape');
        await expect(page.locator('.overlay')).toHaveCount(0);
      }
    }
    record(info, `06-${theme}`, readings);
  });

  test(`MP-0276-07 separators stay quieter and thinner than selection and focus (${theme})`, async ({ page }, info) => {
    await useTheme(page, theme, theme);
    const readings = [];
    for (const width of WIDTHS) {
      for (const [route, pick, marker] of [
        ['/library', '.library-rows .library-batch-check input', '.library-rows .song-row.selected'],
        ['/mix/current/edit', '.timeline .song-select', '.editor-scope.is-current'],
      ] as const) {
        await open(page, route, width);
        await page.keyboard.press('Tab');
        if (route === '/library') await page.locator(pick).first().check();
        await page.locator(pick).first().focus();
        const reading = await measure(page, separators, [marker, ':focus'] as [string, string]);
        const where = `${route} ${theme} ${width}px`;
        expect(reading.rules.length, `${where}: separators found`).toBeGreaterThan(0);
        expect(reading.marker, `${where}: a state marker`).not.toBeNull();
        expect(reading.ring, `${where}: a focus ring`).not.toBeNull();
        expect(reading.ring!.style, where).not.toBe('none');
        for (const rule of reading.rules) {
          expect(rule.width, `${where}: ${rule.name} weight`).toBeLessThan(reading.marker!.width);
          expect(rule.width, `${where}: ${rule.name} weight`).toBeLessThan(reading.ring!.width);
          expect(rule.contrast, `${where}: ${rule.name} against the selected marker`).toBeLessThan(reading.marker!.contrast);
          expect(rule.contrast, `${where}: ${rule.name} against the focus ring`).toBeLessThan(reading.ring!.contrast);
        }
        readings.push({ route, width, ...reading, rules: [...new Map(reading.rules.map((rule) => [rule.name, rule])).values()] });
      }
    }
    record(info, `07-${theme}`, readings);
  });
}

test('MP-0276-08 System, Light, Dark and forced colours keep the same state meaning', async ({ page }, info) => {
  const signature = async () => {
    await open(page, '/library', 1440);
    await page.keyboard.press('Tab');
    await page.locator('.library-rows .library-batch-check input').first().check();
    await page.locator('.library-rows .library-batch-check input').first().focus();
    const selected = (await measure(page, stateCues, '.library-rows .song-row.selected'))[0];
    const focus = (await measure(page, stateCues, '.library-rows .library-batch-check:focus-within'))[0];
    const roles = (await measure(page, surfaceRoles, {})).roles;
    return { selected, focus, roles };
  };
  const readings: Record<string, Awaited<ReturnType<typeof signature>>> = {};
  for (const os of THEMES) {
    await useTheme(page, 'system', os);
    readings[`system-${os}`] = await signature();
    await useTheme(page, os, os === 'light' ? 'dark' : 'light'); // explicit choice against the OS
    readings[os] = await signature();
    // System follows the OS exactly as the explicit choice does
    expect(readings[`system-${os}`], `System on a ${os} OS matches ${os}`).toEqual(readings[os]);
  }
  for (const theme of THEMES) {
    const { selected, focus } = readings[theme];
    // the same cue shapes in both themes, and each one stands off its surface (non-text 3:1)
    expect(selected.bar, `${theme}: selected bar`).toBe(3);
    expect(focus.outline, `${theme}: focus ring`).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(contrastOf, [selected.barColour!, selected.background] as [Rgba, Rgba]), `${theme}: selected bar contrast`).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(contrastOf, [focus.outlineColour, focus.ground] as [Rgba, Rgba]), `${theme}: focus ring contrast`).toBeGreaterThanOrEqual(3);
  }
  expect({ bar: readings.light.selected.bar, ring: readings.light.focus.outline }).toEqual({ bar: readings.dark.selected.bar, ring: readings.dark.focus.outline });

  // forced colours drop every shadow: the selected row, playing song and focus still look different
  const forced = [];
  for (const os of THEMES) {
    await page.emulateMedia({ colorScheme: os, forcedColors: 'active', reducedMotion: 'reduce' });
    await page.evaluate(() => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: 'system', motion: 'still' })));
    await open(page, '/library', 1440);
    await page.keyboard.press('Tab');
    await page.locator('.library-rows .library-batch-check input').first().check();
    const rows = await measure(page, stateCues, '.library-rows .song-row');
    const chosen = rows.find((row) => row.name.includes('selected'))!;
    const other = rows.find((row) => !row.name.includes('selected'))!;
    expect(chosen.outline, `forced ${os}: selected row outline`).toBeGreaterThanOrEqual(2);
    expect(other.outline, `forced ${os}: unselected row`).toBe(0);
    await page.locator('.library-rows .library-batch-check input').nth(1).focus();
    const ring = (await measure(page, stateCues, '.library-rows .library-batch-check:focus-within'))[0];
    expect(ring.outline, `forced ${os}: focus ring`).toBeGreaterThanOrEqual(2);
    await page.locator('.library-rows .library-batch-check input').first().uncheck();

    await open(page, '/mix/current/edit', 1440);
    await page.getByRole('button', { name: /^Play from / }).first().click();
    await expect(page.locator('.timeline .song.playing')).toHaveCount(1, { timeout: 60_000 });
    const playing = (await measure(page, stateCues, '.timeline .song.playing'))[0];
    const resting = (await measure(page, stateCues, '.timeline .song:not(.playing)'))[0];
    expect(playing.startBorder, `forced ${os}: playing bar`).toBeGreaterThanOrEqual(3);
    expect(resting.startBorder, `forced ${os}: resting row`).toBeLessThan(playing.startBorder);
    expect(playing.text).toContain('Playing now');
    const scope = (await measure(page, stateCues, '.editor-scope.is-current'))[0];
    expect(scope.startBorder, `forced ${os}: current-mix scope bar`).toBeGreaterThanOrEqual(3);
    await page.getByRole('button', { name: 'Pause' }).first().click().catch(() => undefined);
    // overlays keep an edge once their shadow is gone
    await page.locator('.theme-menu > button').first().click();
    const menu = (await measure(page, overlayDepth, ['.menu-list', false] as const))!;
    expect(menu.edgeWidth, `forced ${os}: menu edge`).toBeGreaterThanOrEqual(1);
    await page.keyboard.press('Escape');
    forced.push({ os, chosen, other, ring, playing, resting, scope, menu });
  }
  record(info, '08', { readings, forced });
});
