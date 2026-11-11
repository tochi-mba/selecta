/* P0125 (ADR-0045), the parts that need no browser: status is never colour alone, and with the
 * operating system's colours forced the focus ring and the selected mark stay two different shapes.
 * Text and edge contrast in both themes: MP-0298-05 and web/src/styles/boundary-roles.test.ts.
 * The rendered forced-colour check: web/e2e/flow-forced-colors.e2e.ts. */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Status } from './controls';

type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const polish = fs.readFileSync(`${node.cwd()}/src/styles/polish.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const KINDS = ['planned', 'queued', 'working', 'paused', 'recovering', 'ready', 'warning', 'blocked', 'failed', 'needs-action', 'unavailable'] as const;

describe('P0125 status information is never colour alone', () => {
  it('every status kind has its own words and a drawn mark', () => {
    const seen = new Map<string, string>();
    for (const kind of KINDS) {
      const { container, unmount } = render(<Status kind={kind} />);
      const status = container.querySelector('.status')!;
      const words = status.textContent?.trim() ?? '';
      expect(words, kind).not.toBe('');
      expect(status.querySelector('svg'), `${kind} has no mark`).not.toBeNull();
      expect(seen.has(words), `${kind} reads the same as ${seen.get(words)}`).toBe(false);
      seen.set(words, kind);
      unmount();
    }
  });

  it('ready, warning and failed differ in their mark, not only their colour', () => {
    const mark = (kind: (typeof KINDS)[number]) => {
      const { container, unmount } = render(<Status kind={kind} />);
      const shape = container.querySelector('.status svg')!.innerHTML;
      unmount();
      return shape;
    };
    expect(new Set([mark('ready'), mark('warning'), mark('failed')]).size).toBe(3);
  });
});

/** the declarations of the last rule in a forced-colours block whose selector contains every part
 * (a focus rule only when a part asks for :focus-visible) */
function forcedRule(...parts: string[]): Record<string, string> {
  const blocks = [...polish.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]);
  let found: Record<string, string> | null = null;
  for (const body of blocks) {
    for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].replace(/\s+/g, ' ');
      const wantsFocus = parts.some((part) => part.includes(':focus-visible'));
      if (parts.every((part) => selector.includes(part)) && (wantsFocus || !selector.includes(':focus-visible'))) {
        found = Object.fromEntries([...rule[2].matchAll(/([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
      }
    }
  }
  expect(found, parts.join(' ')).not.toBeNull();
  return found!;
}

describe('P0125 forced colours keep focus visible and apart from selection', () => {
  const width = (outline: string) => Number.parseFloat(outline);

  it('keyboard focus is a 3px system-colour ring outside the control', () => {
    const focus = forcedRule(':is(button, a, input', ':focus-visible');
    expect(focus.outline).toMatch(/^3px solid Highlight$/);
    expect(Number.parseFloat(focus['outline-offset'])).toBeGreaterThan(0);
  });

  it('the selected mark is thinner and drawn inside, so it never reads as focus', () => {
    const selected = forcedRule(".nav a[aria-current='page']", "button[aria-pressed='true'])");
    const focus = forcedRule(':is(button, a, input', ':focus-visible');
    expect(width(selected.outline)).toBeLessThan(width(focus.outline));
    expect(Number.parseFloat(selected['outline-offset'])).toBeLessThan(0);
  });

  it('focus on the selected item still draws the focus ring, not the selected mark', () => {
    const both = forcedRule(".nav a[aria-current='page']", "button[aria-pressed='true']):focus-visible");
    expect(both.outline).toMatch(/^3px solid Highlight$/);
    expect(Number.parseFloat(both['outline-offset'])).toBeGreaterThan(0);
  });

  it('warnings and problems keep a system colour, and disabled controls read as disabled', () => {
    expect(forcedRule('.status-warning', '.warn').color).toBe('Mark');
    expect(forcedRule('button:disabled').color).toBe('GrayText');
  });
});
