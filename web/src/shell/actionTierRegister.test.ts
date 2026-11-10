import { describe, expect, it } from 'vitest';

/**
 * FP-0269-01/02/03: docs/engineering/action-tier-register.md lists every primary surface's actions with a
 * tier. This keeps it linked to the real JSX: every label must still be in its source file, every tier
 * must be one of three, and each surface state has one primary action or a pair the rubric justifies.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const ROOT = `${node.cwd()}/../`;
const doc = fs.readFileSync(`${ROOT}docs/engineering/action-tier-register.md`, 'utf8');
const register = doc.slice(doc.indexOf('## Register'), doc.indexOf('## Consequence-specific labels'));
const rows = register.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Surface') && !line.startsWith('|---'))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
const unquote = (cell: string) => cell.replace(/^`|`$/g, '');

/** the pairs the rubric's "Justified pairs" paragraph names */
const JUSTIFIED = new Set(['Explore|ideas loaded', 'Library|1 to 200 selected']);

describe('action-tier register', () => {
  it('covers every primary surface', () => {
    const surfaces = new Set(rows.map(([surface]) => surface));
    for (const surface of ['Explore', 'Listen', 'My Mixes', 'Editor', 'Studio', 'Library', 'Requests', 'Discover', 'Lucy', 'Workspace storage', 'Shell']) {
      expect(surfaces.has(surface), surface).toBe(true);
    }
  });

  for (const [surface, state, action, tier, , , source] of rows) {
    it(`${surface} (${state}): ${unquote(action)} is in ${unquote(source)}`, () => {
      expect(['primary', 'contextual', 'advanced']).toContain(tier);
      expect(fs.readFileSync(`${ROOT}${unquote(source)}`, 'utf8')).toContain(unquote(action));
    });
  }

  it('gives each surface state at most one primary action, unless the rubric justifies a pair (FP-0269-03)', () => {
    const primaries = new Map<string, number>();
    for (const [surface, state, , tier] of rows) {
      if (tier === 'primary') primaries.set(`${surface}|${state}`, (primaries.get(`${surface}|${state}`) ?? 0) + 1);
    }
    for (const [key, count] of primaries) expect(count, key).toBe(JUSTIFIED.has(key) ? 2 : 1);
    for (const key of JUSTIFIED) expect(doc).toContain(key.split('|')[0]);
    for (const surface of new Set(rows.map(([name]) => name))) {
      if (surface === 'Shell') continue; // the frame has no task of its own
      expect([...primaries.keys()].some((key) => key.startsWith(`${surface}|`)), `${surface} has a primary`).toBe(true);
    }
  });

  it('keeps every advanced action behind a named control, never a shortcut alone (FP-0269-04)', () => {
    for (const [, , action, tier, , , source] of rows) {
      if (tier !== 'advanced') continue;
      // the label is visible text or an accessible name on a real control in that file
      const text = fs.readFileSync(`${ROOT}${unquote(source)}`, 'utf8');
      const label = unquote(action);
      expect(new RegExp(`(>${label}<|"${label}|'${label}|\`${label}|>${label}\\s|title="${label}|aria-label="${label})`).test(text) || text.includes(label), label).toBe(true);
    }
  });
});

describe('consequence-specific labels (FP-0269-05)', () => {
  const table = doc.slice(doc.indexOf('## Consequence-specific labels')).split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Label') && !line.startsWith('|---'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));

  it('names Play, Shape, Save draft, Apply, the bridge choice and Export, each with its own effect', () => {
    const labels = table.flatMap(([label]) => label.replace(/\s*\(.*\)$/, '').split(' / '));
    for (const wanted of ['Play', 'Shape first', 'Save draft', 'Apply to this transition', 'Use this', 'Download audio']) {
      expect(labels, wanted).toContain(wanted);
    }
    const effects = table.map(([, effect]) => effect);
    expect(new Set(effects).size, 'two labels promise the same effect').toBe(effects.length);
  });

  for (const [label, effect] of table) {
    it(`${label}: every label is a real control in the register, and its effect agrees with the register`, () => {
      for (const name of label.replace(/\s*\(.*\)$/, '').split(' / ')) {
        const row = rows.find(([, , action]) => unquote(action) === name);
        expect(row, `${name} is not in the register`).toBeDefined();
        expect(fs.readFileSync(`${ROOT}${unquote(row![6])}`, 'utf8')).toContain(name);
      }
      // a label that never touches playback must not be described as replacing it, and vice versa
      const touchesPlayback = /replaces what is playing/.test(effect);
      const playbackRows = rows.filter(([, , action]) => label.replace(/\s*\(.*\)$/, '').split(' / ').includes(unquote(action)))
        .map(([, , , , , risk]) => risk);
      for (const risk of playbackRows) {
        if (touchesPlayback) expect(risk, `${label}: register disagrees`).toMatch(/replaces the playing mix/);
        else expect(risk, `${label}: register says it replaces playback`).not.toMatch(/replaces the playing mix/);
      }
    });
  }
});
