import { writeFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * FP-0264-01/02/05/07 (ADR-0264): every functional edge in the app, measured where it actually sits.
 *
 * For each route and state below, in Light and in Dark, this finds the form controls, tabs, menus,
 * dialogs and selectable rows on screen, records the edge role each one plays and the surface it
 * sits on, and computes the real non-text contrast of its boundary against that surface from the
 * browser's own computed colours. A control's boundary is whichever of its border, its own filled
 * background or its outline stands out most from the surface around it.
 *
 * Roles (tokens.css): interactive (a field, select, tab or checkbox: must reach 3:1), selected and
 * focus (state markers: must reach 3:1), and decorative (dividers between rows: exempt, recorded so
 * the exemption is explicit). A row or button named by its own text is identified by that text, so
 * its outline is decorative under WCAG 1.4.11; it is recorded, not failed.
 *
 * The JSON report written to the test's output folder is the contrast report FP-0264-02 asks for.
 * It is candidate evidence for a reviewer, never an independent sign-off.
 */

type Edge = {
  state: string; theme: string; role: string; component: string; label: string;
  edge: number; surface: string; essential: boolean;
};

const STATES: { id: string; path: string; prepare?: (page: Page) => Promise<void> }[] = [
  { id: 'library-list', path: '/library' },
  {
    id: 'library-selected', path: '/library',
    prepare: async (page) => {
      await page.getByRole('checkbox', { name: /^Select recording/ }).first().check();
      await expect(page.getByRole('button', { name: 'Clear selection' })).toBeVisible();
    },
  },
  {
    id: 'library-cards', path: '/library',
    prepare: async (page) => {
      const cards = page.getByRole('radio', { name: /cards/i });
      if (await cards.count()) await cards.first().check();
    },
  },
  {
    id: 'shape-dialog', path: '/mixes',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Customize' }).click();
      await expect(page.getByRole('dialog', { name: 'Shape the next mix' })).toBeVisible();
    },
  },
  { id: 'editor', path: '/mix/current/edit' },
  { id: 'workshop', path: '/workshop' },
];

async function measure(page: Page, state: string, theme: string): Promise<Edge[]> {
  return page.evaluate(([stateId, themeId]) => {
    const parse = (value: string): [number, number, number, number] | null => {
      const rgb = value.match(/^rgba?\(([^)]+)\)$/);
      if (rgb) {
        const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
      }
      const srgb = value.match(/^color\(srgb ([^)]+)\)$/);
      if (srgb) {
        const parts = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return [parts[0], parts[1], parts[2], parts[3] ?? 1];
      }
      return null;
    };
    const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] =>
      [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])) as [number, number, number];
    const surfaceOf = (start: Element | null): [number, number, number] => {
      const layers: [number, number, number, number][] = [];
      for (let node = start; node; node = node.parentElement) {
        const colour = parse(getComputedStyle(node).backgroundColor);
        if (colour && colour[3] > 0) {
          layers.push(colour);
          if (colour[3] >= 1) break;
        }
      }
      let base: [number, number, number] = parse(getComputedStyle(document.documentElement).backgroundColor)?.slice(0, 3) as [number, number, number] ?? [1, 1, 1];
      for (const layer of layers.reverse()) base = over(layer, base);
      return base;
    };
    const luminance = ([r, g, b]: [number, number, number]) => {
      const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const contrast = (a: [number, number, number], b: [number, number, number]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
    const visible = (node: Element) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const scope = document.querySelector('[role="dialog"]') ?? document.querySelector('main#main') ?? document.body;
    const roles: [string, string, boolean][] = [
      ['input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), textarea', 'interactive: text field', true],
      ['select', 'interactive: dropdown', true],
      ['input[type=checkbox], input[type=radio]', 'interactive: choice', true],
      ['[role=tab], [role=combobox], [role=switch]', 'interactive: tab/combobox/switch', true],
      ['[aria-selected=true], [aria-current=true], [aria-current=page], .song-row.selected, [aria-pressed=true]', 'selected', true],
      ['.song-row, .lib-card, li[role=option], [role=menuitem], [role=menuitemradio]', 'decorative: text-named row', false],
      ['[role=dialog], .overlay-panel', 'interactive: dialog edge', false],
    ];
    const out: Edge[] = [];
    const seen = new Set<Element>();
    for (const [selector, role, essential] of roles) {
      for (const node of scope.querySelectorAll(selector)) {
        if (seen.has(node) || !visible(node)) continue;
        seen.add(node);
        const style = getComputedStyle(node);
        const surface = surfaceOf(node.parentElement);
        const candidates: number[] = [];
        const own = parse(style.backgroundColor);
        if (own && own[3] > 0) candidates.push(contrast(over(own, surface), surface));
        for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
          const width = Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`));
          const colour = parse(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
          if (width >= 1 && colour && colour[3] > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none') {
            candidates.push(contrast(over(colour, surface), surface));
          }
        }
        const native = (node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio')) && style.appearance !== 'none';
        const label = (node.getAttribute('aria-label') ?? (node as HTMLElement).innerText ?? node.getAttribute('name') ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
        out.push({
          state: stateId, theme: themeId, role: native ? `${role} (browser-drawn)` : role,
          component: `${node.tagName.toLowerCase()}${node.className && typeof node.className === 'string' ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`,
          label, edge: candidates.length ? Math.max(...candidates) : 1, surface: hex(surface),
          // A browser-drawn checkbox or radio is painted by the browser in its own contrast-safe colours.
          essential: essential && !native,
        });
      }
    }
    return out;
  }, [state, theme] as const) as Promise<Edge[]>;
}

test.beforeEach(async ({ request }) => resetMix(request));

test('functional edges reach 3:1 against their real surfaces in Light and Dark (FP-0264-01/02)', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const report: Edge[] = [];
  for (const theme of ['light', 'dark'] as const) {
    await page.goto('/mixes');
    await page.evaluate((chosen) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })), theme);
    for (const state of STATES) {
      await page.goto(state.path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('main#main')).toBeVisible();
      await state.prepare?.(page);
      report.push(...await measure(page, state.id, theme));
    }
  }
  writeFileSync(info.outputPath('fp-0264-boundary-contrast.json'), JSON.stringify({
    status: 'candidate-not-independently-verified', threshold: 3, measured: report.length, edges: report,
  }, null, 2));
  for (const state of STATES) for (const theme of ['light', 'dark']) {
    expect(report.some((edge) => edge.state === state.id && edge.theme === theme), `${state.id} ${theme} measured nothing`).toBe(true);
  }
  const failing = report.filter((edge) => edge.essential && edge.edge < 3);
  expect(failing, JSON.stringify(failing, null, 1)).toEqual([]);
});
