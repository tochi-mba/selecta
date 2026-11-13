import { describe, expect, it } from 'vitest';

/**
 * ADR-0274 static guards: the parts of optical alignment a stylesheet can be checked for without a
 * browser. The measured proof is web/e2e/mp-0274-optical-alignment.e2e.ts.
 */
// Read from disk through Node's own loader, as spacing-tokens.test.ts does (CSS ?raw imports are empty in Vitest).
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const FILES = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)];
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Rule = { file: string; selector: string; body: string };
const rules: Rule[] = FILES.flatMap((file) => [...read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ file, selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] })));
const declares = (rule: Rule, property: string) => new RegExp(`(?:^|;|\\s)${property}\\s*:`).test(rule.body);

describe('page anchors (MP-0274-01)', () => {
  it('names each page width once, on .content, so the breadcrumb bar shares the column', () => {
    const subject = /^(?:\.content > )?(?:main)?\.page(?:\.[\w-]+)*$|^\.now(?:\.[\w-]+)*$|^\.listen-empty$/;
    const widths = rules.filter((rule) => declares(rule, 'max-width') && rule.selector.split(',').some((part) => subject.test(part.trim())));
    // the plain .page fallback outside the app frame, the Stage's full width and the one owner on .content
    expect(widths.map((rule) => `${rule.file} ${rule.selector}`).sort()).toEqual([
      'style.css .page',
      'styles/listening.css .now.stage',
      'styles/shell.css .content > main.page',
    ]);
    expect(widths.find((rule) => rule.file === 'styles/shell.css')?.body).toMatch(/max-width: var\(--page-max\)/);
    for (const page of ['browse', 'mixes', 'library', 'mix', 'lucy', 'now', 'listen-empty']) {
      const owner = rules.find((rule) => rule.file === 'styles/shell.css' && rule.selector.startsWith('.content:has(')
        && rule.selector.split(/[(,]/).some((part) => part.trim().replace(/\)$/, '') === `> main.page.${page}`) && declares(rule, '--page-max'));
      expect(owner, `.page.${page} has no column width`).toBeDefined();
    }
    expect(read('styles/shell.css')).toMatch(/padding-inline: max\(var\(--gutter\), calc\(\(100% - var\(--page-max\)\) \/ 2 \+ var\(--gutter\)\)\)/);
  });
});

describe('numeric baselines (MP-0274-03)', () => {
  it('gives every changing number equal-width digits', () => {
    const tabular = rules.filter((rule) => /font-variant-numeric:\s*tabular-nums/.test(rule.body)).map((rule) => rule.selector).join(' , ');
    for (const selector of ['.time', '.count', '.facts', '.metrics strong', '.countdown-number', '.library-summary b', '.studio-playhead']) {
      expect(tabular, `${selector} lacks tabular-nums`).toContain(selector);
    }
  });

  it('reserves the clock its longest reading, so it never widens mid-song', () => {
    // the seek strip and its clock live in NowStrip.tsx (split out of Now.tsx)
    const now = fs.readFileSync(`${SOURCE}views/NowStrip.tsx`, 'utf8');
    expect(now).toMatch(/className="time" style=\{\{ minWidth: `\$\{\(unavailable \? 0 : clock\(duration\)\.length \* 2\) \+ 3\}ch` \}\}/);
    expect(read('styles/listening.css')).toMatch(/\.strip \.time \{ text-align: end; \}/);
  });
});

describe('wrapped actions (MP-0274-04)', () => {
  it('ends an idea card with its actions, which stretch to one height', () => {
    const mixes = fs.readFileSync(`${SOURCE}views/Mixes.tsx`, 'utf8');
    const card = mixes.slice(mixes.indexOf('<article className="card vibe-card"'), mixes.indexOf('</article>'));
    expect(card.indexOf('className="row card-actions"')).toBeGreaterThan(card.indexOf('className="vibe-card-detail"'));
    const listening = read('styles/listening.css');
    expect(listening).toMatch(/\.vibe-card \{[^}]*display: flex;[^}]*flex-direction: column;/);
    expect(listening).toMatch(/\.vibe-card > \.vibe-card-detail \{ margin-top: auto; \}/);
    expect(listening).toMatch(/\.vibe-card \.card-actions \{[^}]*align-items: stretch;/);
    expect(read('styles/creation.css')).toMatch(/\.editor-actions \{ display: grid;[^}]*align-items: stretch;/);
  });
});

describe('border joins and focus rings (MP-0274-05)', () => {
  it('draws rings inside targets that fill a scroller edge to edge', () => {
    expect(read('styles/shell.css')).toMatch(/\.nav li a:focus-visible, \.nav-more-mobile:focus-visible \{ outline-offset: -4px; \}/);
    expect(read('styles/creation.css')).toMatch(/\.studio-grid \.studio-name:focus-visible \{ outline-offset: -4px; \}/);
    expect(read('styles/polish.css')).toMatch(/\.studio-cell:focus-visible \{ outline: 3px solid var\(--focus\); outline-offset: -4px; \}/);
  });

  it('tucks the pinned scope bar under the context bar hairline', () => {
    expect(read('styles/creation.css')).toMatch(/\.editor-scope \{[^}]*top: calc\(var\(--header-block\) - 1px\);/);
  });
});

describe('sticky offsets (MP-0274-06)', () => {
  it('pins nothing below the context bar by the nominal --header-height', () => {
    const offsets = rules.filter((rule) => /(?:^|;)\s*(?:top|max-height|scroll-padding-top)\s*:[^;]*--header-height/.test(rule.body));
    expect(offsets.map((rule) => `${rule.file} ${rule.selector}`)).toEqual([]);
    const sticky = ['.editor-scope', '.edit-inspector', '.listen-side', '.lucy-tabs', '.page.lucy.is-split .lucy-side'];
    for (const selector of sticky) {
      // shell.css loads before creation.css (main.tsx), so the inspector's later rule is the one in force
      const owner = rules.some((entry) => entry.selector.startsWith(selector) && /(?:^|;)\s*top:[^;]*var\(--header-block\)/.test(entry.body));
      expect(owner, `${selector} is not pinned under --header-block`).toBe(true);
    }
    expect(read('styles/tokens.css')).toMatch(/--header-block: var\(--header-height\);/);
    expect(read('styles/tokens.css')).toMatch(/scroll-padding-top: calc\(var\(--header-block\) \+ var\(--space-4\)\);/);
  });

  it('publishes the bar height from the shell, and removes it with the bar', () => {
    const shell = fs.readFileSync(`${SOURCE}shell/Shell.tsx`, 'utf8');
    expect(shell).toMatch(/root\.style\.setProperty\('--header-block'/);
    expect(shell).toMatch(/root\.style\.removeProperty\('--header-block'\)/);
    expect(shell).toMatch(/<header className="context-bar" ref=\{bar\}>/);
  });
});

describe('scrollbar movement (MP-0274-07)', () => {
  it('reserves the gutter on the page and on every inner scroller that changes length', () => {
    const gutters = rules.filter((rule) => /scrollbar-gutter:\s*stable/.test(rule.body)).map((rule) => rule.selector).join(' , ');
    for (const selector of ['html', '.edit-inspector', '.overlay-body', '.lyrics-scroll', '.studio-grid']) expect(gutters).toContain(selector);
  });
});
