import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** GP-0257-01, motion half (the foreground-message half is in gp-0257-comfort.test.tsx): every
 * animation in the app, counted by how much it asks of the listener. Only waiting indicators may loop,
 * and the system and Still settings stop all of them. A new animation fails here until it is placed. */

type Severity = 'answers-you' | 'arrives' | 'waiting';
const INVENTORY: Record<string, Severity> = {
  'button-working': 'waiting',
  'overlay-appear': 'answers-you',
  'route-reveal': 'arrives',
  'skeleton-reveal': 'arrives',
  'feeling-reveal': 'arrives',
  'toast-appear': 'arrives',
  'skeleton-breathe': 'waiting',
  'pending-flow': 'waiting',
  'request-pulse': 'waiting',
  'lucy-slide': 'waiting',
};

const SRC = join(process.cwd(), 'src');
function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith('.css') ? [path] : [];
  });
}
const css = stylesheets(SRC).map((file) => readFileSync(file, 'utf8')).join('\n');

describe('GP-0257-01 motion changes, counted by severity', () => {
  const names = [...new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((found) => found[1]))];

  it('places every animation in the app, and counts them by how much they ask of you', () => {
    const unplaced = names.filter((name) => !(name in INVENTORY));
    expect(unplaced).toEqual([]);
    const counts: Record<Severity, number> = { 'answers-you': 0, arrives: 0, waiting: 0 };
    for (const name of names) counts[INVENTORY[name]] += 1;
    console.log(`GP-0257-01 motion changes by severity: ${JSON.stringify(counts)}`);
    expect(counts['answers-you'] + counts.arrives + counts.waiting).toBe(names.length);
  });

  it('only lets something waiting loop forever', () => {
    const looping = [...css.matchAll(/animation:\s*([\w-]+)[^;]*\binfinite\b/g)].map((found) => found[1]);
    expect(looping.length).toBeGreaterThan(0);
    for (const name of looping) expect(INVENTORY[name], `${name} loops`).toBe('waiting');
  });

  it('stops every animation under the system setting and under Still', () => {
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((found) => found[1]);
    expect(reduced.some((block) => /\*, \*::before, \*::after/.test(block)
      && /animation-duration: 0ms !important/.test(block) && /animation-iteration-count: 1 !important/.test(block))).toBe(true);
    expect(css).toMatch(/:root\[data-motion='still'\] \*,[\s\S]*?animation: none !important;/);
  });
});
