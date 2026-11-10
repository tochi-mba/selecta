import { describe, expect, it } from 'vitest';

/**
 * S4-0090-01: every colour consumer in the site goes through a semantic role. uf-cascade.test.ts already
 * keeps raw colours out of style.css and styles/*.css; this scan covers every other stylesheet the site
 * ships (feature folders such as guest, rooms, display and devices) and every non-test script, so a
 * new page or overlay cannot bring its own literal colour in quietly. The few literals that remain
 * are listed here with the reason each one has to be literal.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const ALL = fs.readdirSync(SOURCE, { recursive: true }).map((file) => file.replace(/\\/g, '/'));
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;

/** Feature entry points that load without tokens.css define their own small token block. */
const OWN_TOKEN_BLOCKS = new Set(['guest/guest.css', 'display/display.css']);
/** A QR code needs a white quiet zone in either theme, or phones cannot read it. */
const QR_WHITE = /^\.(?:room-qr|d-qr)\b/;

function strays(sheet: string): string[] {
  const css = strip(fs.readFileSync(SOURCE + sheet, 'utf8'));
  const found: string[] = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of body.split(';')) {
      if (!declaration.match(LITERAL)) continue;
      const [property, ...rest] = declaration.split(':');
      const value = rest.join(':').trim();
      const name = property.trim();
      if (OWN_TOKEN_BLOCKS.has(sheet) && name.startsWith('--')) continue;
      // a fallback inside var() only applies if tokens.css is missing, so the role still decides
      if (value.replace(/var\(--[a-z0-9-]+,\s*[^()]*(?:\([^()]*\))?[^()]*\)/gi, '').match(LITERAL) === null) continue;
      if (QR_WHITE.test(selector.trim()) && name === 'background' && value === '#fff') continue;
      found.push(`${sheet} ${selector.trim()} { ${declaration.trim()} }`);
    }
  }
  return found;
}

describe('S4-0090-01 colour consumers', () => {
  const sheets = ALL.filter((file) => file.endsWith('.css') && file !== 'styles/tokens.css');

  it('finds the feature stylesheets as well as the main ones', () => {
    for (const sheet of ['style.css', 'guest/guest.css', 'rooms/rooms.css', 'display/display.css', 'devices/devices.css']) {
      expect(sheets).toContain(sheet);
    }
  });

  it('no stylesheet outside tokens.css uses a raw colour except a listed, explained exception', () => {
    expect(sheets.flatMap(strays)).toEqual([]);
  });

  it('every var() fallback colour names a token that tokens.css really defines', () => {
    const tokens = strip(fs.readFileSync(`${SOURCE}styles/tokens.css`, 'utf8'));
    for (const sheet of sheets.filter((file) => !OWN_TOKEN_BLOCKS.has(file))) {
      for (const [, token] of strip(fs.readFileSync(SOURCE + sheet, 'utf8')).matchAll(/var\((--[a-z0-9-]+),\s*#/gi)) {
        expect(tokens, `${sheet} falls back for ${token}, which tokens.css does not define`).toMatch(new RegExp(`${token}\\s*:`));
      }
    }
  });

  it('scripts paint no literal colour except the listed first-paint and QR cases', () => {
    const scripts = ALL.filter((file) => /\.(?:ts|tsx)$/.test(file) && !/\.test\.|\/test\/|\.d\.ts$/.test(file));
    const allowed: Record<string, RegExp> = {
      // the browser chrome colour is set before any stylesheet exists, matching tokens.css --bg
      'state/prefs.ts': /const BAR_COLOUR = \{ dark: '#100f0c', light: '#f5f2e9' \};/,
      // the QR code's own white quiet zone
      'rooms/qr.ts': /fill="#fff"/,
    };
    const found: string[] = [];
    for (const file of scripts) {
      const text = fs.readFileSync(SOURCE + file, 'utf8');
      for (const line of text.split('\n')) {
        if (!/['"`]#[0-9a-fA-F]{3,8}['"`]|fill="#|\b(?:rgba?|hsla?)\(\s*\d/.test(line)) continue;
        if (allowed[file]?.test(line)) continue;
        found.push(`${file}: ${line.trim().slice(0, 120)}`);
      }
    }
    expect(found).toEqual([]);
  });
});
