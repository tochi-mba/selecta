import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** S3-0077-02: the inline script in index.html applies a chosen theme and the title bar colour
 * before the app's own JavaScript loads, so a chosen theme never flashes the other one. */

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const inline = /<script>([\s\S]*?)<\/script>/.exec(head)?.[1] ?? '';
const DARK = '#100f0c';
const LIGHT = '#f5f2e9';

function page(saved: string | null) {
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${DARK}">
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="${LIGHT}">`;
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  if (saved !== null) localStorage.setItem('selecta.prefs', saved);
  new Function(inline)();
  return {
    attr: document.documentElement.dataset.theme,
    bars: [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((bar) => bar.content),
  };
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('the theme applied before first paint (S3-0077-02)', () => {
  it('runs inline in <head>, after the title-bar tags and before the app module', () => {
    expect(inline).toContain("localStorage.getItem('selecta.prefs')");
    expect(head.indexOf('<script>')).toBeGreaterThan(head.lastIndexOf('<meta name="theme-color"'));
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'));
  });

  it.each([
    ['{"theme":"light"}', 'light', [LIGHT, LIGHT]],
    ['{"theme":"dark"}', 'dark', [DARK, DARK]],
  ] as const)('a saved %s sets data-theme and both title-bar colours', (saved, attr, bars) => {
    expect(page(saved)).toEqual({ attr, bars });
  });

  it.each([
    ['nothing saved', null],
    ['following the computer', '{"theme":"system"}'],
    ['an unknown value', '{"theme":"purple"}'],
    ['unreadable JSON', '{not json'],
  ])('%s leaves the page following the computer', (_label, saved) => {
    expect(page(saved)).toEqual({ attr: undefined, bars: [DARK, LIGHT] });
  });

  it('uses the same colours as the app does after it loads', () => {
    const prefs = readFileSync(resolve(__dirname, 'prefs.ts'), 'utf8');
    expect(prefs).toContain(DARK);
    expect(prefs).toContain(LIGHT);
  });
});
