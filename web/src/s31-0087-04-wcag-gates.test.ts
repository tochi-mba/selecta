import { describe, expect, it } from 'vitest';

/**
 * ADR-0087 (S31-0087-04), the part that needs no browser: the measuring spec and the verification
 * matrix hold the right WCAG 2.2 AA bars. Targets must be 24 CSS px or a named exception (inline or
 * spacing); 44px is the product's aim for primary touch controls only, never called a WCAG rule.
 * Reflow is checked from 320px, contrast at 4.5:1 for text, 3:1 for large text and field edges, and
 * each measurement is written to a report. The browser runs are in web/e2e/mp-0298-responsive-and-a11y.e2e.ts.
 */

type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const spec = fs.readFileSync(`${node.cwd()}/e2e/mp-0298-responsive-and-a11y.e2e.ts`, 'utf8');
const matrix = fs.readFileSync(`${node.cwd()}/../docs/adr/selecta-3-1-verification-matrix.md`, 'utf8');

describe('S31-0087-04 the WCAG gates measure the right bars', () => {
  it('targets: 24px is the floor, exceptions are named, and 44px applies only to primary touch targets', () => {
    expect(spec).toContain('const small = target.width < 24 || target.height < 24;');
    expect(spec).toMatch(/exceptions\.push\(`inline: /);
    expect(spec).toMatch(/exceptions\.push\(`spacing: /);
    expect(spec).toContain("if (mode === 'touch' && target.primary) expect(Math.min(target.width, target.height)");
    expect(spec).toContain('toBeGreaterThanOrEqual(44)');
    // the only 44 in a WCAG assertion is the primary-touch one
    expect(spec.match(/toBeGreaterThanOrEqual\(44\)/g)).toHaveLength(1);
  });

  it('the matrix says 24px is the AA rule and 44px a product aim, not a WCAG requirement', () => {
    expect(matrix).toMatch(/WCAG 2\.2 AA 24×24 CSS px with exceptions; 44px-class is a product touch target where practical, not a fictitious WCAG requirement/);
  });

  it('reflow, contrast and targets are each measured and written to a report', () => {
    expect(spec).toMatch(/test\('MP-0298-01 every page holds from 320 to 3840px/);
    expect(spec).toMatch(/test\('MP-0298-02 200% and 400% zoom keep every page actionable/);
    expect(spec).toMatch(/test\('MP-0298-05 text meets 4\.5:1, large text 3:1 and field edges 3:1 in both themes'/);
    for (const report of ['mp-0298-01-widths.json', 'mp-0298-03-targets.json', 'mp-0298-05-contrast.json']) {
      expect(spec).toContain(`info.outputPath('${report}')`);
    }
  });
});
