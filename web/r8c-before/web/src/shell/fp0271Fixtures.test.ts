import { describe, expect, it } from 'vitest';

/**
 * FP-0271-01: docs/adr/completion/visual-evidence.md names a fixture ID for every surface ADR-0271 lists.
 * This keeps the table honest: each fixture ID must be captured by one of the paired specs, each named
 * source file must exist, and each driven state's MP-0272 fixture must be in the surface inventory.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; existsSync(path: string): boolean };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const WEB = `${node.cwd()}/`;
const doc = fs.readFileSync(`${WEB}../docs/adr/completion/visual-evidence.md`, 'utf8');
const routes = fs.readFileSync(`${WEB}e2e/paired-theme.e2e.ts`, 'utf8');
const driven = fs.readFileSync(`${WEB}e2e/fp-0271-paired-states.e2e.ts`, 'utf8');
const inventory = fs.readFileSync(`${WEB}../docs/adr/mp-0272-surface-inventory.json`, 'utf8');

const section = doc.slice(doc.indexOf('## Canonical route-state fixtures'), doc.indexOf('## Coverage denominator'));
const rows = section.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Surface') && !line.startsWith('|---'))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
const ids = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
const captured = (id: string) => routes.includes(`id: '${id}'`) || routes.includes(`capture('${id}'`) || driven.includes(`id: '${id}'`);

describe('canonical route-state fixtures (FP-0271-01)', () => {
  it('names every surface ADR-0271 lists', () => {
    const surfaces = rows.map(([surface]) => surface);
    expect(surfaces).toEqual(['Start', 'Setup', 'Explore', 'Listen', 'Stage', 'My Mixes', 'Edit', 'Inspector', 'Studio',
      'Requests', 'Discovery', 'Library', 'Details', 'Workspace', 'Backups', 'Export']);
  });

  for (const [surface, fixtures, source] of rows) {
    it(`${surface}: every fixture is captured in both themes and its source exists`, () => {
      expect(ids(fixtures).length).toBeGreaterThan(0);
      for (const id of ids(fixtures)) expect(captured(id), id).toBe(true);
      expect(fs.existsSync(`${WEB}src/${ids(source)[0]}`), ids(source)[0]).toBe(true);
    });
  }

  it('includes empty and error states', () => {
    const all = rows.flatMap(([, fixtures]) => ids(fixtures));
    for (const id of ['library-empty-search', 'setup-first-run', 'library-failed', 'offline']) expect(all).toContain(id);
  });

  it('ties each driven state to a fixture in the MP-0272 surface inventory', () => {
    const mp = [...driven.matchAll(/mp: '([^']+)'/g)].map((match) => match[1]);
    expect(mp.length).toBeGreaterThanOrEqual(9);
    for (const fixture of mp) expect(inventory, fixture).toContain(`"${fixture}"`);
  });
});
