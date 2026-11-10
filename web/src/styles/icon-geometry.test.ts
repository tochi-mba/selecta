import { describe, expect, it } from 'vitest';
import { ICON_NAMES, ICON_SLOTS, ICON_STROKES, type IconSize } from '../ui/Icon';

/**
 * ADR-0277 static checks: the icon inventory, the size slots and their strokes, and the badge and gap
 * rules in styles/icons.css. Geometry in the browser: web/e2e/mp-0277-icon-geometry.e2e.ts.
 */
// Vitest hands CSS ?raw imports back empty and the app's tsconfig has no Node types, so files are read
// through Node's own loader, from web/ (where vitest runs), as spacing-tokens.test.ts does.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const read = (path: string) => fs.readFileSync(`${SOURCE}${path}`, 'utf8');
const inventory = fs.readFileSync(`${SOURCE}../../docs/engineering/icon-inventory.md`, 'utf8');
const tokens = read('styles/tokens.css');
const icons = read('styles/icons.css');
const SLOTS = Object.keys(ICON_SLOTS) as IconSize[];
const TOKEN: Record<IconSize, { box: string; stroke: string }> = {
  compact: { box: '--icon-compact', stroke: '--icon-stroke-compact' },
  toolbar: { box: '--icon-toolbar', stroke: '--icon-stroke-toolbar' },
  standard: { box: '--icon-size', stroke: '--icon-stroke' },
  hero: { box: '--icon-hero', stroke: '--icon-stroke-hero' },
};

/** The glyph table: icon -> slots and owner files. */
const rows = new Map([...inventory.slice(inventory.indexOf('## Glyphs')).matchAll(/^\| `([a-z]+)` \| [^|]+ \| ([^|]+) \| ([^|]+) \|/gm)].map((row) => [row[1], {
  slots: row[2].split(',').map((slot) => slot.trim()),
  owners: [...row[3].matchAll(/`([\w/]+\.tsx?)`/g)].map((owner) => owner[1]),
}]));

/** Every <Icon /> in the app's own views whose name is written out, with the slot it asks for. */
function drawn() {
  const files = fs.readdirSync(SOURCE, { recursive: true }).map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file.endsWith('.tsx') && !file.includes('.test.') && /^(ui|views|shell)\//.test(file));
  const uses: Array<{ file: string; name: string; size: string; raw: string }> = [];
  for (const file of files) {
    for (const tag of read(file).matchAll(/<Icon\b([^>]*?)\/>/g)) {
      const props = tag[1];
      const named = props.match(/name=(?:"([a-z]+)"|\{([^}]*)\})/);
      const size = props.match(/size="([a-z]+)"/)?.[1] ?? 'standard';
      const names = named?.[1] ? [named[1]] : [...(named?.[2] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1]).filter((name) => (ICON_NAMES as string[]).includes(name));
      for (const name of names) uses.push({ file, name, size, raw: tag[0] });
    }
  }
  return uses;
}

describe('icon inventory (MP-0277-01)', () => {
  it('lists every glyph once, at real slots', () => {
    expect([...rows.keys()].sort()).toEqual([...ICON_NAMES].sort());
    for (const [name, row] of rows) for (const slot of row.slots) expect(SLOTS, `${name} slot ${slot}`).toContain(slot);
  });

  it('names every file that draws a glyph, at a slot its row allows', () => {
    const uses = drawn();
    expect(uses.length).toBeGreaterThan(60);
    for (const use of uses) {
      const row = rows.get(use.name);
      expect(row, `${use.file}: ${use.raw}`).toBeDefined();
      expect(row!.owners, `${use.file} draws ${use.name} but is not an owner`).toContain(use.file);
      expect(row!.slots, `${use.file} draws ${use.name} at ${use.size}`).toContain(use.size);
    }
  });

  it('never sizes or strokes an icon by hand', () => {
    for (const use of drawn()) expect(use.raw, use.file).not.toMatch(/\b(?:width|height|strokeWidth)=/);
  });
});

describe('icon slots and strokes (MP-0277-02, MP-0277-04)', () => {
  it('are four deliberate, increasing sizes', () => {
    expect(ICON_SLOTS).toEqual({ compact: 14, toolbar: 16, standard: 20, hero: 28 });
  });

  it('match their tokens, and icons.css applies each one', () => {
    for (const slot of SLOTS) {
      expect(tokens, slot).toMatch(new RegExp(`${TOKEN[slot].box}: ${ICON_SLOTS[slot]}px;`));
      expect(tokens, slot).toMatch(new RegExp(`${TOKEN[slot].stroke}: ${ICON_STROKES[slot]};`));
      const rule = slot === 'standard' ? /^\.ui-icon \{([^}]*)\}/m : new RegExp(`^\\.ui-icon\\[data-size='${slot}'\\] \\{([^}]*)\\}`, 'm');
      const body = icons.match(rule)?.[1] ?? '';
      expect(body, slot).toContain(`width: var(${TOKEN[slot].box})`);
      expect(body, slot).toContain(`height: var(${TOKEN[slot].box})`);
      expect(body, slot).toContain(`stroke-width: var(${TOKEN[slot].stroke})`);
    }
  });

  it('draw the same line weight on screen at every slot', () => {
    const drawnWidth = SLOTS.map((slot) => (ICON_STROKES[slot] * ICON_SLOTS[slot]) / 24);
    for (const width of drawnWidth) {
      expect(width).toBeGreaterThanOrEqual(1.35);
      expect(width).toBeLessThanOrEqual(1.45);
    }
  });
});

describe('gaps and badges (MP-0277-03, MP-0277-05)', () => {
  it('a busy Action keeps its icon row and its gap token', () => {
    expect(icons).toMatch(/\.action-labels > span:has\(> \.ui-icon\) \{[^}]*gap: var\(--icon-gap\)/);
    expect(icons).toMatch(/\.icon-words \{[^}]*gap: var\(--icon-gap-dense\)/);
  });

  it('counters reserve two digits from their start edge', () => {
    expect(icons).toMatch(/\.context-bar \.count, \.nav \.count \{[^}]*min-width: 2ch;[^}]*text-align: start;/);
  });

  it('icons.css loads after the page sheets and before typography.css', () => {
    const imports = [...read('main.tsx').matchAll(/import '\.\/(styles\/[\w-]+\.css|style\.css)';/g)].map((match) => match[1]);
    const at = (sheet: string) => imports.indexOf(sheet);
    for (const page of ['style.css', 'styles/shell.css', 'styles/polish.css', 'styles/foundation.css', 'styles/listening.css', 'styles/creation.css', 'styles/operations.css']) {
      expect(at('styles/icons.css'), page).toBeGreaterThan(at(page));
    }
    expect(at('styles/icons.css')).toBeLessThan(at('styles/typography.css'));
  });
});
