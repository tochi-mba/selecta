import { describe, expect, it } from 'vitest';
import inventory from '../../../docs/adr/mp-0272-surface-inventory.json' with { type: 'json' };
import summary from '../../../docs/adr/mp-0272-measured-summary.json' with { type: 'json' };

// Markdown outside web/ can't be imported ?raw, so it is read from disk as spacing-tokens.test.ts does.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const page = (node.getBuiltinModule('node:fs') as Fs).readFileSync(`${node.cwd()}/../docs/adr/mp-0299-review-denominator.md`, 'utf8');

/** MP-0299-01: the review denominator page states exactly what the inventory and the measured
 * summary say is required, captured and reviewed, per group and in total. */
type Entry = { id: string; fixtureId: string; denominator: number; measured: string[] };
const THEMES = 2;
const viewports = inventory.viewports.length;
const coverage = summary.coverage as Record<string, number>;

function counts(entries: Entry[]) {
  let required = 0;
  let captured = 0;
  for (const entry of entries) {
    required += entry.denominator * viewports * THEMES;
    const seen = Math.min(coverage[entry.id] ?? coverage[entry.fixtureId] ?? 0, viewports);
    captured += entry.measured.length * seen;
  }
  return { surfaces: entries.length, required, captured, reviewed: 0 };
}

const rows = page.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Group') && !line.startsWith('| ---'));
const row = (name: string) => {
  const cells = rows.find((line) => line.replace(/\*/g, '').startsWith(`| ${name} |`))!.replace(/\*/g, '').split('|').map((cell) => cell.trim()).filter(Boolean);
  return { surfaces: Number(cells[1]), required: Number(cells[2]), captured: Number(cells[3]), reviewed: Number(cells[4]) };
};

describe('MP-0299-01 review denominator', () => {
  it('uses 11 viewports and two themes', () => {
    expect(viewports).toBe(11);
    expect(page).toContain('11 viewports x 2 themes');
  });

  it('states the required, captured and reviewed counts each group really has', () => {
    const groups = {
      Routes: counts(inventory.routes as Entry[]),
      'Persistent surfaces': counts(inventory.persistent as Entry[]),
      Overlays: counts(inventory.overlays as Entry[]),
    };
    for (const [name, expected] of Object.entries(groups)) expect(row(name), name).toEqual(expected);
    const total = Object.values(groups).reduce((sum, group) => ({
      surfaces: sum.surfaces + group.surfaces, required: sum.required + group.required, captured: sum.captured + group.captured, reviewed: 0,
    }), { surfaces: 0, required: 0, captured: 0, reviewed: 0 });
    expect(row('Total')).toEqual(total);
    expect(page).toContain(`${((100 * total.captured) / total.required).toFixed(1)}% of required`);
  });
});
