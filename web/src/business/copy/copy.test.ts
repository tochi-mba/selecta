// BZ-0453-21: every business string lives in a copy module, says SelectaDJ, has no em dashes and
// no exclamation marks. Customer-facing copy (the kiosk) never names a cause; that list is held by
// customerSeparation.test.ts. The owner's read of the copy deck is still a person step.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = join(process.cwd(), 'src', 'business', 'copy');
const modules = readdirSync(here).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

/** The string literals in a module (quoted and template), comments left out. */
function strings(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

describe('business copy deck', () => {
  it('has copy modules', () => expect(modules).toContain('states.ts'));

  for (const name of modules) {
    const source = readFileSync(join(here, name), 'utf-8');
    const words = strings(source).filter((text) => /[A-Za-z]{3,}\s/.test(text));
    it(`${name}: no em dashes`, () => expect(source.includes('—')).toBe(false));
    it(`${name}: no exclamation marks in copy`, () => expect(words.filter((text) => /!(\s|$)/.test(text))).toEqual([]));
    it(`${name}: says SelectaDJ, never Selecta alone`, () => expect(words.filter((text) => /\bSelecta\b(?!DJ)/.test(text))).toEqual([]));
    it(`${name}: no jargon`, () => expect(words.filter((text) => /\b(device principal|cache|lease|tenant|entitlement|SSE)\b/i.test(text))).toEqual([]));
  }
});
