import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { allRendered, resetMix } from './helpers';
import { assertNoPersonalData, provenance } from './pairedEvidence';

/**
 * Flow SF-0201-08, the automatable part: a reviewer screenshot gallery of every relevant screen at a
 * phone size and a desktop size, in Light and Dark, written into the repo so a person can open one
 * page and approve it. Approval itself stays a person's step (the manifest's reviewer is null).
 *
 * This reuses, rather than repeats, the existing captures: paired-theme.e2e.ts already proves the
 * controls do not change between themes (and keeps its pairs in test-results), and visual.e2e.ts
 * captures error and empty states. What neither does is keep a gallery a reviewer can open, at
 * 390x844 and 1440x900, with an index. Only the made-up library from tests/e2e_server.py is shown.
 */
const OUT = '../docs/verification/claude-checks/flow/theme-gallery';
const MAX_BYTES = 300 * 1024;

const VIEWPORTS = [
  { id: 'mobile', width: 390, height: 844 },
  { id: 'desktop', width: 1440, height: 900 },
] as const;
const THEMES = ['light', 'dark'] as const;

/** Every page the router knows (router.ts), plus the dialogs and states a reviewer must also see. */
const SCREENS: Array<{ id: string; title: string; path: string; open?: (page: Page) => Promise<void> }> = [
  { id: 'explore', title: 'Explore (start page)', path: '/mixes' },
  { id: 'my-mixes', title: 'My Mixes', path: '/mixes/mine' },
  { id: 'listen', title: 'Listen', path: '/listen' },
  { id: 'editor', title: 'Edit the current mix', path: '/mix/current/edit' },
  { id: 'library', title: 'Library', path: '/library' },
  { id: 'discover-words', title: 'Discover: words', path: '/discover' },
  { id: 'discover-harmonic', title: 'Discover: harmonic', path: '/discover/harmonic' },
  { id: 'lucy', title: 'Lucy', path: '/mixes/lucy' },
  { id: 'workspace', title: 'Workspace overview', path: '/workshop' },
  { id: 'analysis', title: 'Workspace: analysis', path: '/workshop/analysis' },
  { id: 'storage', title: 'Workspace: storage and backups', path: '/workshop/storage' },
  { id: 'learning', title: 'Workspace: learning', path: '/workshop/learning' },
  { id: 'listening-study', title: 'Listening study', path: '/listening' },
  { id: 'missing-page', title: 'Page not found', path: '/no-such-page' },
  {
    id: 'export-dialog', title: 'Export dialog', path: '/mix/current/edit', open: async (page) => {
      await page.getByRole('button', { name: 'Download audio' }).click();
      await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
    },
  },
  {
    id: 'customize-dialog', title: 'Shape the next mix', path: '/mixes', open: async (page) => {
      await page.getByRole('button', { name: 'Customize' }).click();
      await expect(page.getByRole('dialog', { name: 'Shape the next mix' })).toBeVisible();
    },
  },
  {
    id: 'requests-dialog', title: 'Requests', path: '/listen', open: async (page) => {
      await page.keyboard.press('r');
      await expect(page.getByRole('dialog', { name: 'Requests' })).toBeVisible();
    },
  },
  {
    id: 'song-details', title: 'Song details', path: '/library', open: async (page) => {
      await page.getByRole('button', { name: /^Details for Paper Moon/ }).click();
      await expect(page.getByRole('dialog', { name: 'Paper Moon' })).toBeVisible();
    },
  },
  {
    id: 'transition-inspector', title: 'Transition inspector', path: '/mix/current/edit', open: async (page) => {
      await page.getByRole('button', { name: 'Change', exact: true }).first().click();
      await expect(page.getByRole('tab', { name: 'Change' })).toBeVisible();
    },
  },
  {
    id: 'library-selection', title: 'Library with a selection', path: '/library', open: async (page) => {
      await page.getByRole('checkbox', { name: /^Select recording/ }).first().check();
      await expect(page.getByRole('button', { name: 'Prioritize selected' })).toBeVisible();
    },
  },
  {
    id: 'library-no-results', title: 'Library search with no results', path: '/library?q=nothing-is-called-this',
    open: async (page) => { await expect(page.getByText(/Nothing matches/)).toBeVisible(); },
  },
];

/** Left out on purpose, and said so in the gallery, so the denominator is honest. */
const EXCLUDED = [
  'Workspace: sources and diagnostics. Paused by the privacy rule of 2026-11-12: the test server '
    + 'showed a local folder path there. Add them once the server roots its library elsewhere.',
  'Saved draft editor (/mixes/drafts/N/edit): the same editor as Edit the current mix, on a draft.',
];

type Shot = { screen: string; title: string; path: string; viewport: string; width: number; height: number; theme: string; files: string[] };

async function settle(page: Page) {
  const main = page.locator('main#main:not([aria-busy="true"])');
  await expect(main).toBeVisible();
  // the component gallery's specimens are permanent skeletons; route placeholders must settle
  await expect(main.locator('.skeleton:not(.control-gallery .skeleton)')).toHaveCount(0);
  await page.waitForTimeout(250);
}

/** One PNG when the whole page fits in 300 KB, otherwise the page in window-high parts. */
async function shoot(page: Page, base: string): Promise<string[]> {
  const options = { fullPage: true, animations: 'disabled', caret: 'hide' } as const;
  const whole = await page.screenshot(options);
  if (whole.length <= MAX_BYTES) {
    writeFileSync(`${OUT}/${base}.png`, whole);
    return [`${base}.png`];
  }
  const { width, height } = page.viewportSize()!;
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const files: string[] = [];
  for (let y = 0, part = 1; y < total; y += height, part += 1) {
    const clip = { x: 0, y, width, height: Math.min(height, total - y) };
    const buffer = await page.screenshot({ ...options, clip });
    expect.soft(buffer.length, `${base} part ${part} is over 300 KB`).toBeLessThanOrEqual(MAX_BYTES);
    writeFileSync(`${OUT}/${base}-part${part}.png`, buffer);
    files.push(`${base}-part${part}.png`);
  }
  return files;
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Rebuilds the index from every manifest present, so each viewport's test can run on its own. */
function writeIndex() {
  const shots: Shot[] = readdirSync(OUT).filter((name) => /^manifest-.*\.json$/.test(name))
    .flatMap((name) => (JSON.parse(readFileSync(`${OUT}/${name}`, 'utf8')) as { shots: Shot[] }).shots);
  const meta = provenance();
  const columns = VIEWPORTS.flatMap((v) => THEMES.map((theme) => ({ viewport: v.id, theme, label: `${v.id} ${v.width}x${v.height} ${theme}` })));
  const cell = (screen: string, viewport: string, theme: string) => {
    const shot = shots.find((s) => s.screen === screen && s.viewport === viewport && s.theme === theme);
    if (!shot) return '<td class="gap">not captured</td>';
    return `<td>${shot.files.map((file) => `<a href="${file}"><img src="${file}" alt="${escape(`${shot.title}, ${shot.viewport}, ${shot.theme}`)}" loading="lazy"></a>`).join('')}</td>`;
  };
  const rows = SCREENS.map((screen) => `<tr><th scope="row">${escape(screen.title)}<br><code>${escape(screen.path)}</code></th>${columns.map((c) => cell(screen.id, c.viewport, c.theme)).join('')}</tr>`).join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SF-0201-08 theme gallery</title>
<style>
body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; background: #faf7f2; color: #2a2420; }
table { border-collapse: collapse; } th, td { border: 1px solid #d8cfc4; padding: 6px; vertical-align: top; }
td img { display: block; width: 180px; margin-bottom: 4px; border: 1px solid #d8cfc4; }
td.gap { color: #a33; } thead th { position: sticky; top: 0; background: #faf7f2; }
</style></head><body>
<h1>SelectaDJ theme gallery (SF-0201-08)</h1>
<p>Status: candidate, not approved. A reviewer approves by checking every row in Light and Dark at both sizes,
then recording their name and date on SF-0201-08. Source ${escape(meta.sourceSha ?? 'unknown')}, ${escape(meta.os)},
Edge, reduced motion, made-up library (tests/e2e_server.py, fixture ${escape(meta.fixtureDataVersion)}).
${shots.length} of ${SCREENS.length * columns.length} screen captures present. Click a thumbnail for full size.</p>
<table><thead><tr><th>Screen</th>${columns.map((c) => `<th>${escape(c.label)}</th>`).join('')}</tr></thead>
<tbody>
${rows}
</tbody></table>
<h2>Not in this gallery</h2><ul>${EXCLUDED.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>
</body></html>
`;
  const markdown = [
    '# SF-0201-08 theme gallery',
    '',
    'Candidate screenshots for a reviewer, not an approval. Open `index.html` in this folder to see them side by side.',
    `Generated by \`web/e2e/sf0201-theme-gallery.e2e.ts\` from source ${meta.sourceSha ?? 'unknown'} with the made-up library.`,
    '',
    '| Screen | Path | ' + columns.map((c) => c.label).join(' | ') + ' |',
    '| --- | --- | ' + columns.map(() => '---').join(' | ') + ' |',
    ...SCREENS.map((screen) => `| ${screen.title} | \`${screen.path}\` | ` + columns.map((c) => {
      const shot = shots.find((s) => s.screen === screen.id && s.viewport === c.viewport && s.theme === c.theme);
      return shot ? shot.files.map((file) => `[${file}](${file})`).join(' ') : 'not captured';
    }).join(' | ') + ' |'),
    '',
    '## Not in this gallery',
    '',
    ...EXCLUDED.map((line) => `- ${line}`),
    '',
    '## Reviewer approval',
    '',
    'Reviewer: (name) - Date: (date) - Result: (approved / changes needed, with the rows that need work)',
    '',
  ].join('\n');
  assertNoPersonalData(html);
  assertNoPersonalData(markdown);
  writeFileSync(`${OUT}/index.html`, html);
  writeFileSync(`${OUT}/README.md`, markdown);
}

test.beforeEach(async ({ request }) => resetMix(request));

for (const viewport of VIEWPORTS) {
  test(`SF-0201-08 theme gallery at ${viewport.width}x${viewport.height} in Light and Dark`, async ({ page, request }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const shots: Shot[] = [];
    for (const theme of THEMES) {
      await resetMix(request);
      // every transition made, so the editor reads the same in both themes
      await allRendered(request);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/mixes');
      await page.evaluate((chosen) => {
        localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' }));
      }, theme);
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await settle(page);
        if (screen.open) await screen.open(page);
        await page.waitForTimeout(150);
        const files = await shoot(page, `${viewport.id}-${theme}-${screen.id}`);
        shots.push({ screen: screen.id, title: screen.title, path: screen.path, viewport: viewport.id, width: viewport.width, height: viewport.height, theme, files });
      }
    }
    expect(shots).toHaveLength(SCREENS.length * THEMES.length);
    const manifest = JSON.stringify({
      task: 'SF-0201-08',
      status: 'candidate-not-approved',
      ...provenance(),
      capturedAt: new Date().toISOString(),
      browser: 'msedge',
      motion: 'still/reduced',
      fixture: 'tests/e2e_server.py',
      excluded: EXCLUDED,
      shots,
    }, null, 2);
    assertNoPersonalData(manifest);
    writeFileSync(`${OUT}/manifest-${viewport.id}.json`, manifest);
    writeIndex();
  });
}
