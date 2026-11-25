import { describe, expect, it } from 'vitest';

/**
 * SF-0245-05 static guards: the part of "every shared primitive's hover, focus and active states are
 * consistent" a stylesheet can be checked for. The interactive screenshot grid review is a person's job.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const FILES = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)];
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = FILES.flatMap((file) => [...read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ file, selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] })));
const parts = (selector: string) => selector.split(',').map((part) => part.trim());

// Things focused by the app itself (a page, a heading after navigation, a panel), never by Tab, so a
// ring there would only be noise. None of them is a control.
const PROGRAMMATIC = new Set(['.content:focus', '.overlay-panel:focus', '.now:focus', '.glossary-entry h3:focus', '.drafts-head .section-title:focus', "main.page h1[tabindex='-1']:focus"]);

describe('SF-0245-05 shared primitives keep one hover, focus and active language', () => {
  it('gives every native control the same focus ring in the focus colour', () => {
    const base = rules.find((rule) => rule.file === 'style.css' && parts(rule.selector).includes('button:focus-visible'));
    expect(base).toBeDefined();
    for (const control of ['button', 'input', 'select', 'a', 'summary']) expect(parts(base!.selector)).toContain(`${control}:focus-visible`);
    expect(base!.body).toMatch(/outline:\s*2px solid var\(--focus\)/);
  });

  it('draws every focus outline in the focus colour (or Highlight / currentColor in forced colours)', () => {
    const outlines = rules.filter((rule) => /:focus-visible/.test(rule.selector) && /outline(?:-color)?\s*:/.test(rule.body));
    expect(outlines.length).toBeGreaterThan(10);
    for (const rule of outlines) {
      for (const declaration of rule.body.match(/outline(?:-color)?\s*:[^;]+/g) ?? []) {
        expect(declaration, `${rule.file} ${rule.selector}`).toMatch(/var\(--focus\)|Highlight|currentColor/);
      }
    }
  });

  it('never takes the focus ring away from a control', () => {
    const removed = rules.filter((rule) => /:focus/.test(rule.selector) && /outline\s*:\s*(?:none|0)\b/.test(rule.body));
    for (const rule of removed) for (const part of parts(rule.selector)) {
      expect(PROGRAMMATIC.has(part), `${rule.file} ${part} removes the outline`).toBe(true);
    }
  });

  it('shows whatever hovering reveals on keyboard focus too', () => {
    const reveals = rules.filter((rule) => /:hover/.test(rule.selector) && /opacity\s*:\s*1\b|visibility\s*:\s*visible/.test(rule.body));
    expect(reveals.length).toBeGreaterThan(0);
    // either the hover rule names focus itself, or (ADR-0477: hover-only rules live inside
    // `(hover: hover) and (pointer: fine)`, where every selector must hover) a twin outside it in the
    // same sheet reveals the same thing for the same element on focus
    const focus = /:focus-visible|:focus-within/;
    for (const rule of reveals) {
      if (focus.test(rule.selector)) continue;
      const twins = parts(rule.selector).map((part) => {
        const [head, tail] = [part.slice(0, part.indexOf(':hover')), part.slice(part.indexOf(':hover') + ':hover'.length)];
        return rules.some((other) => other.file === rule.file && !/:hover/.test(other.selector) && focus.test(other.selector)
          && other.selector.split(/,\s*(?![^()]*\))/).some((candidate) => candidate.startsWith(head) && candidate.endsWith(tail) && focus.test(candidate))
          && /opacity\s*:\s*1\b|visibility\s*:\s*visible/.test(other.body));
      });
      expect(twins.every(Boolean), `${rule.file} ${rule.selector} has no focus twin`).toBe(true);
    }
  });

  it('never lights up a disabled button on hover, and marks a pressed button the same way everywhere', () => {
    const hover = rules.find((rule) => rule.file === 'style.css' && rule.selector === 'button:hover:not(:disabled)');
    expect(hover?.body).toMatch(/border-color:\s*var\(--ink\)/);
    expect(rules.some((rule) => rule.file === 'style.css' && rule.selector === 'button:hover')).toBe(false);
    const pressed = rules.find((rule) => rule.file === 'style.css' && rule.selector === "button[aria-pressed='true']");
    expect(pressed?.body).toMatch(/background:\s*var\(--ink\)/);
  });

  it('gives a bordered checkbox or radio choice the same hover edge as a button, never when disabled', () => {
    // found in the 2026-11-12 state-grid review: the gallery checkbox was the one primitive with no hover cue
    const hover = rules.find((rule) => /^\.choice:hover/.test(rule.selector));
    expect(hover?.body).toMatch(/border-color:\s*var\(--ink\)/);
    expect(hover?.selector).toMatch(/:not\(:disabled\)/);
  });
});
