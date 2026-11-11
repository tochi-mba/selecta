import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir, release, userInfo } from 'node:os';
import { expect, Page } from '@playwright/test';

/**
 * Shared by the paired Light/Dark candidate specs (FP-0271-02, -04, -05): provenance without anything
 * personal, a check that a manifest holds no local path or user name, and the palette-free semantic
 * fingerprint of a page's controls.
 */
export function provenance() {
  let sourceSha = process.env.GITHUB_SHA ?? null;
  try { sourceSha ??= execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const fixture = readFileSync(new URL('../../tests/e2e_server.py', import.meta.url));
  return {
    sourceSha,
    os: `${process.platform} ${release()}`,
    fixtureDataVersion: createHash('sha256').update(fixture).digest('hex').slice(0, 16),
    reviewer: null as string | null, // set only by a named person approving the pairs (FP-0271-06)
  };
}

/** Nothing identifying may be in a manifest that leaves this machine. */
export function assertNoPersonalData(text: string) {
  const name = (() => { try { return userInfo().username; } catch { return ''; } })();
  for (const secret of [homedir(), homedir().replace(/\\/g, '/'), name].filter((value) => value.length > 2)) {
    expect(text.toLowerCase().includes(secret.toLowerCase()), 'manifest holds a local path or user name').toBe(false);
  }
  expect(text).not.toMatch(/[A-Za-z]:[\\/]Users|\/home\/|\.mp3|\.flac|@[a-z0-9-]+\.[a-z]/i);
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Every control's role, label and state inside `root`, except the theme switcher's own button. The palette must not change any of it. With
 * `clock` set, digits are blanked, so a playing state's elapsed time does not count as a difference.
 */
export const controlSemantics = (page: Page, root: string, clock = false) => page.locator(root).first().evaluate((main, blank) =>
  // the theme switcher names the theme it is showing, which is the one thing a pair is meant to differ in
  JSON.stringify([...main.querySelectorAll('button, input, select, textarea, summary, [role="tab"], [role="slider"], a[href]')].filter((node) => !node.closest('.theme-menu')).map((node) => {
    const label = (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    return {
      tag: node.tagName,
      role: node.getAttribute('role'),
      label: blank ? label.replace(/[0-9]/g, '#') : label,
      pressed: node.getAttribute('aria-pressed'),
      selected: node.getAttribute('aria-selected'),
      checked: node.getAttribute('aria-checked'),
      current: node.getAttribute('aria-current'),
      expanded: node.getAttribute('aria-expanded'),
      disabled: (node as HTMLButtonElement).disabled === true,
    };
  })), clock);
