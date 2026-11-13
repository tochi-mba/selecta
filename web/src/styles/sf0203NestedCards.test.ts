// @vitest-environment node
import { parseAst } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * Flow SF-0203-04, the part code can check: music objects keep their hierarchy without box clutter,
 * so a card surface (a rounded, bordered, filled and padded box) is not drawn inside another card
 * surface. The guard reads every stylesheet to find the card classes, then walks the JSX of every
 * component and fails on a card element nested inside another card element in the same file.
 * Nestings that later work chose on purpose are allow-listed below with their reason. Whether the
 * result looks calm is the visual critique, which stays a person step.
 */
// Same loader as spacing-tokens.test.ts: Vitest hands CSS ?raw imports back empty.
type Dirent = { name: string; isDirectory(): boolean };
type Fs = {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
};
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;

const walk = (dir: string): string[] => fs.readdirSync(SOURCE + dir, { withFileTypes: true }).flatMap((entry) => {
  const path = dir ? `${dir}/${entry.name}` : entry.name;
  return entry.isDirectory() ? walk(path) : [path];
});
const ALL = walk('');
const CSS = ALL.filter((path) => path === 'style.css' || (path.startsWith('styles/') && path.endsWith('.css')));
const TSX = ALL.filter((path) => path.endsWith('.tsx') && !/\.test\.tsx$/.test(path) && !path.startsWith('test/'));
const read = (path: string) => fs.readFileSync(SOURCE + path, 'utf8');

/** A declaration that draws something: not none, not zero, not transparent. */
const drawn = (body: string, property: string) => {
  const values = [...body.matchAll(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, 'g'))].map((match) => match[1].trim());
  return values.length ? !/^(none|0|0px|transparent|unset|initial)\b/.test(values[values.length - 1]) : undefined;
};

/** Split CSS selector lists only at top-level commas, not inside :is() or :where(). */
function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== '\\') quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Classes whose own rules make a card surface: rounded, bordered, filled and padded. */
function cardClasses(): Set<string> {
  const traits = new Map<string, Record<string, boolean>>();
  for (const file of CSS) {
    const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = match[2];
      const found = {
        radius: drawn(body, 'border-radius'),
        border: drawn(body, 'border'),
        fill: drawn(body, 'background(?:-color)?'),
        padding: drawn(body, 'padding'),
      };
      for (const selector of splitSelectors(match[1])) {
        const own = selector.trim().match(/^\.([\w-]+)$/);
        if (!own) continue;
        const entry = traits.get(own[1]) ?? {};
        for (const [trait, value] of Object.entries(found)) if (value !== undefined) entry[trait] = value;
        traits.set(own[1], entry);
      }
    }
  }
  return new Set([...traits].filter(([, entry]) => entry.radius && entry.border && entry.fill && entry.padding).map(([name]) => name));
}

type Node = { type: string; start: number; [key: string]: unknown };
const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';

/** Every string written into a className attribute, including inside template and conditional expressions. */
function classNames(attribute: Node): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isNode(value)) return;
    if (value.type === 'Literal' && typeof value.value === 'string') out.push(...value.value.split(/\s+/));
    if (value.type === 'TemplateElement') out.push(...String((value.value as { cooked?: string }).cooked ?? '').split(/\s+/));
    for (const [key, child] of Object.entries(value)) if (key !== 'type') visit(child);
  };
  visit(attribute.value);
  return out.filter(Boolean);
}

type Nesting = { at: string; outer: string; inner: string };
type Opening = Node & { attributes: Node[]; name: Node & { name?: string } };

/** The card classes an element draws itself, or that its component draws as its root. */
function ownCards(opening: Opening, cards: Set<string>, components: Map<string, string>): string | null {
  const className = opening.attributes.find((attribute) => attribute.type === 'JSXAttribute'
    && (attribute.name as Node & { name: string }).name === 'className');
  const own = className ? [...new Set(classNames(className).filter((name) => cards.has(name)))] : [];
  if (own.length) return own.join('.');
  return opening.name.type === 'JSXIdentifier' ? components.get(opening.name.name ?? '') ?? null : null;
}

/** Components whose outermost returned element is a card surface, so `<Panel>` counts as `.panel`. */
function componentCards(sources: [string, string][], cards: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  const firstJsx = (value: unknown): Node | null => {
    if (Array.isArray(value)) { for (const item of value) { const hit = firstJsx(item); if (hit) return hit; } return null; }
    if (!isNode(value)) return null;
    if (value.type === 'JSXElement') return value;
    // Stop at a nested function: its JSX is a callback's, not this component's root.
    if (/Function/.test(value.type)) return null;
    for (const [key, child] of Object.entries(value)) { if (key === 'type') continue; const hit = firstJsx(child); if (hit) return hit; }
    return null;
  };
  const record = (name: string, body: unknown) => {
    if (!/^[A-Z]/.test(name)) return;
    const root = isNode(body) && body.type === 'JSXElement' ? body : firstJsx(isNode(body) ? (body as Node).body ?? body : body);
    const drawn = root ? ownCards(root.openingElement as Opening, cards, new Map()) : null;
    if (!drawn) return;
    if (map.has(name) && map.get(name) !== drawn) ambiguous.add(name);
    map.set(name, drawn);
  };
  for (const [, code] of sources) {
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!isNode(value)) return;
      if (value.type === 'FunctionDeclaration' && isNode(value.id)) record(String(value.id.name), value.body);
      if (value.type === 'VariableDeclarator' && isNode(value.id) && isNode(value.init) && /Function/.test(value.init.type)) {
        record(String(value.id.name), value.init.body);
      }
      for (const [key, child] of Object.entries(value)) if (key !== 'type') visit(child);
    };
    visit(parseAst(code, { lang: 'tsx' } as never));
  }
  for (const name of ambiguous) map.delete(name);
  return map;
}

function nestingsIn(file: string, code: string, cards: Set<string>, components = new Map<string, string>()): Nesting[] {
  const found: Nesting[] = [];
  const lineOf = (offset: number) => code.slice(0, offset).split('\n').length;
  const visit = (value: unknown, outer: string | null) => {
    if (Array.isArray(value)) { value.forEach((item) => visit(item, outer)); return; }
    if (!isNode(value)) return;
    if (value.type === 'JSXElement') {
      const opening = value.openingElement as Opening;
      const inner = ownCards(opening, cards, components);
      if (inner && outer) found.push({ at: `${file}:${lineOf(value.start)}`, outer, inner });
      visit(opening.attributes, outer);
      visit(value.children, inner ?? outer);
      return;
    }
    for (const [key, child] of Object.entries(value)) if (key !== 'type') visit(child, outer);
  };
  visit(parseAst(code, { lang: 'tsx' } as never), null);
  return found;
}
const SOURCES: [string, string][] = TSX.map((file) => [file, read(file)]);
const nestings = (cards: Set<string>) => {
  const components = componentCards(SOURCES, cards);
  return SOURCES.flatMap(([file, code]) => nestingsIn(file, code, cards, components));
};

/**
 * Card-in-card nestings that are deliberate. Key: `outer > inner`, value: why the inner box earns it.
 */
const ALLOWED: Record<string, string> = {
  'panel > card': 'ControlGallery is the dev-only specimen sheet; each specimen card sits on the gallery panel on purpose (not a product surface).',
  'panel > problem': 'Storage, folder and specimen panels must show an actionable failure within their own context instead of hiding it elsewhere.',
  'adder > problem': 'The add-song form displays its recoverable input error immediately beside the control the user can fix.',
  'lucy-approve > problem': 'Lucy approvals surface refusal and retry guidance beside the decision without losing the pending proposal.',
  'requests > problem': 'Song search failures appear beside the request field and its retry action, rather than in a distant page banner.',
};

describe('nested cards (SF-0203-04)', () => {
  const cards = cardClasses();
  const found = nestings(cards);

  it('finds the card surfaces the stylesheets define', () => {
    for (const name of ['panel', 'card', 'song', 'editor', 'lucy-card', 'edit-inspector']) expect(cards.has(name), name).toBe(true);
    expect(cards.size).toBeGreaterThan(20);
  });

  it('draws no card surface inside another card surface unless the nesting is allow-listed with a reason', () => {
    const unexpected = found.filter((item) => !ALLOWED[`${item.outer} > ${item.inner}`]).map((item) => `${item.at} ${item.outer} > ${item.inner}`);
    expect(unexpected).toEqual([]);
  });

  it('keeps every allow-list entry live and justified', () => {
    const seen = new Set(found.map((item) => `${item.outer} > ${item.inner}`));
    for (const [pair, reason] of Object.entries(ALLOWED)) {
      expect(seen.has(pair), `${pair} no longer occurs; drop it from the allow-list`).toBe(true);
      expect(reason.length, pair).toBeGreaterThan(30);
    }
  });

  it('sees nesting through conditionals, lists and template class names', () => {
    const sample = new Set(['panel', 'card']);
    const code = 'const A = () => <div className="panel">{x ? <ul>{xs.map((y) => <li className={`card ${y}`} key={y} />)}</ul> : null}</div>;';
    expect(nestingsIn('sample.tsx', code, sample)).toEqual([{ at: 'sample.tsx:1', outer: 'panel', inner: 'card' }]);
    expect(nestingsIn('flat.tsx', '<div className="panel" /> ; <div className="card" />', sample)).toEqual([]);
  });

  it('flattens CSS-level card-in-card: no card class styled as a boxed descendant of another card class', () => {
    const boxedInside: string[] = [];
    for (const file of CSS) {
      const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = match[2];
        if (!(drawn(body, 'border-radius') && drawn(body, 'border') && drawn(body, 'background(?:-color)?'))) continue;
        for (const selector of splitSelectors(match[1])) {
          const parts = selector.trim().split(/\s*>\s*|\s+/).filter(Boolean);
          if (parts.length < 2) continue;
          const last = parts[parts.length - 1].match(/^\.([\w-]+)/)?.[1];
          const ancestor = parts.slice(0, -1).some((part) => [...part.matchAll(/\.([\w-]+)/g)].some((cls) => cards.has(cls[1])));
          if (last && cards.has(last) && ancestor) boxedInside.push(`${file} ${selector.trim()}`);
        }
      }
    }
    expect(boxedInside).toEqual([]);
  });
});
