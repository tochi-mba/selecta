import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setFlags } from '../flags';
import { sceneTransitionsWanted } from '../shell/sceneTransition';
import { DEFAULT_PREFS, setPrefs } from '../state/prefs';
import { requestWords, type RequestRow } from './Requests';

const row = (extra: Partial<RequestRow> = {}): RequestRow => ({
  id: 1, song_id: 9, title: 'Wanted', artist: 'Someone', status: 'waiting', available: 1, ...extra,
});

describe('UF-0383-01 each request stage means one exact thing', () => {
  const stages = ['searching', 'waiting', 'approve', 'preparing', 'ready'] as const;
  const words = stages.map((stage) =>
    requestWords(row({ after: 'Song A', route: [{ id: 9, title: 'Wanted' }] }), stage as Parameters<typeof requestWords>[1]));

  it('gives searching, waiting, needs approval, preparing and ready a label of their own', () => {
    const labels = words.map((said) => said.label);
    expect(new Set(labels).size).toBe(stages.length);
    for (const label of labels) expect(label.trim()).not.toBe('');
  });

  it('explains each one differently, and only ready says where it joins without asking you', () => {
    const details = words.map((said) => said.detail);
    expect(new Set(details).size).toBe(stages.length);
    const [searching, waiting, approve, , ready] = details;
    expect(ready).toMatch(/Joins after Song A/);
    expect(approve).not.toBe(ready);
    expect(searching).not.toMatch(/Joins after/);
    expect(waiting).not.toMatch(/Joins after/);
  });
});

describe('UF-0388-06 the system reduced-motion setting outranks the app’s own motion choice', () => {
  const windowWith = (reduced: boolean) => ({ matchMedia: () => ({ matches: reduced }) }) as unknown as Window;
  afterEach(() => {
    setFlags(null);
    setPrefs(DEFAULT_PREFS);
  });

  it('turns page animations off under reduced motion even when Expressive is chosen', () => {
    setFlags(null);
    setPrefs({ ...DEFAULT_PREFS, motion: 'expressive' });
    expect(sceneTransitionsWanted(windowWith(false))).toBe(true);
    expect(sceneTransitionsWanted(windowWith(true))).toBe(false);
  });

  it('zeroes every motion token under reduced motion whatever motion the app has set', () => {
    const tokens = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8');
    const blocks = [...tokens.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((found) => found[1]);
    const overriding = blocks.find((block) => block.includes(':root[data-motion]'));
    expect(overriding).toBeDefined();
    for (const token of ['--motion-feedback', '--motion-fast', '--motion-reveal', '--motion-handoff', '--motion-overlay', '--motion-slow']) {
      expect(overriding).toMatch(new RegExp(`${token}: 0ms`));
    }
  });
});
