import { describe, expect, it } from 'vitest';

/** UF-0369-01: every type role the finish names (display, headings, body, metadata, lyrics and
 * numbers) is written down in tokens.css and is what the stylesheets really use. */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const read = (file: string) => fs.readFileSync(`${node.cwd()}/src/${file}`, 'utf8');
const tokens = read('styles/tokens.css');
const style = read('style.css');

describe('the six UF type roles', () => {
  it('display, headings, body, metadata, lyrics and numbers are each described in tokens.css', () => {
    for (const role of ['display', 'page', 'section', 'body', 'meta', 'lyric', 'counter']) {
      expect(tokens, role).toMatch(new RegExp(`^\\s+${role}\\s{2,}\\S`, 'm'));
    }
  });

  it('display, headings, metadata and numbers are real role tokens', () => {
    for (const role of ['display', 'page', 'section', 'meta', 'counter']) {
      expect(tokens).toMatch(new RegExp(`--type-${role}:`));
    }
    expect(tokens).toMatch(/--type-counter:[^;]*var\(--mono\)/);
  });

  it('body text is the --body face at 16px, and the sung lyric uses the display face', () => {
    expect(style).toMatch(/body \{[^}]*font: 16px\/1\.5 var\(--body\)/);
    expect(style).toMatch(/\.lyrics \.sung \{[^}]*font: 800 [^;]*var\(--display\)/);
  });
});
