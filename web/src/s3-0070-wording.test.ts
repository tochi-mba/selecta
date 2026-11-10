import { describe, expect, it } from 'vitest';

/**
 * ADR-0070 (S3-0070-06): no control is a bare cross or letter standing in for Delete, Remove or Close.
 * Every destructive or dismissing control says what it does in words, or carries an accessible name.
 */

const sources = import.meta.glob(['./**/*.tsx', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('S3-0070-06 no bare cross for delete or close', () => {
  it('reads every page and control source', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('no button or link has a cross glyph or a lone X as its only content', () => {
    const bare = /<(button|a|Action)\b[^>]*>\s*(?:×|✕|✖|x|X|&times;)\s*<\/(button|a|Action)>/;
    const found = Object.entries(sources).filter(([, text]) => bare.test(text)).map(([file]) => file);
    expect(found).toEqual([]);
  });

  it('a cross glyph never appears as visible text anywhere in the interface', () => {
    const glyph = /[>{'"`]\s*(?:×|✕|✖)\s*[<}'"`]/;
    const found = Object.entries(sources).filter(([, text]) => glyph.test(text)).map(([file]) => file);
    expect(found).toEqual([]);
  });
});
