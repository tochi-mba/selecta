import { describe, expect, it } from 'vitest';

/** S3-0050-05: one icon set, and a close X is never what deletes something. Close and dismiss
 * buttons use the X; anything that deletes or removes uses the trash can and says so in words. */

const SOURCES = Object.entries(import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }));
const DESTRUCTIVE = /\b(Delete|Remove)\b/;

describe('destructive actions and their icons', () => {
  it('never pairs the close X with Delete or Remove', () => {
    const offenders: string[] = [];
    for (const [file, text] of SOURCES) {
      text.split('\n').forEach((line, index) => {
        if (line.includes('Icon name="close"') && DESTRUCTIVE.test(line.replace(/aria-label=\{[^}]*\}|title=\{[^}]*\}/g, ''))) offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('gives every iconned Delete or Remove the trash can and a visible word', () => {
    const lines = SOURCES.flatMap(([file, text]) => text.split('\n').map((line, index) => ({ where: `${file}:${index + 1}`, line })));
    const iconned = lines.filter(({ line }) => /<Icon name="[a-z-]+"[^>]*\/>\s*(Delete|Remove)\b/.test(line));
    expect(iconned.length).toBeGreaterThan(0);
    for (const { where, line } of iconned) expect(`${where} ${/<Icon name="trash"/.test(line)}`).toBe(`${where} true`);
  });

  it('labels the close X as closing or dismissing, never as deleting', () => {
    for (const [file, text] of SOURCES) {
      for (const line of text.split('\n').filter((item) => item.includes('Icon name="close"') && item.includes('aria-label='))) {
        const label = /aria-label=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(line);
        if (!label) continue;
        expect(`${file} ${label[1] ?? label[2]}`).not.toMatch(/\b(Delete|Remove)\b/);
      }
    }
  });
});
