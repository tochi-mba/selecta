// BZ-0445-01: the kiosk entry builds with no React and no manager code. The build itself fails
// on a leak (rooms.vite.ts runs `forbiddenModules`); this test walks the kiosk's real source
// imports from main.ts with the same rule, and checks the rule on a made-up bundle.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedInKiosk, forbiddenModules, type FenceItem } from './bundleFence';

const SRC = resolve(__dirname, '..');

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found = [...text.matchAll(/^\s*import\s+(?:type\s+)?[^'"]*?['"]([^'"]+)['"]/gm)]
    .filter((match) => !/^\s*import\s+type\s/.test(match[0]))
    .map((match) => match[1]);
  return found;
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return `/node_modules/${spec}/`;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate) && !candidate.endsWith('/') && /\.(ts|tsx|css)$/.test(candidate)) return candidate;
  }
  return null;
}

function kioskModules(): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) return;
    for (const spec of importsOf(file)) {
      const target = resolveImport(file, spec);
      if (target) walk(target);
    }
  };
  walk(resolve(SRC, 'kiosk/main.ts'));
  return [...seen];
}

describe('the kiosk entry fence (ADR-0453 D1)', () => {
  it('loads no React, no manager code and only the two offline files from business', () => {
    const modules = kioskModules();
    expect(modules.length).toBeGreaterThan(10);
    const leaked = modules.filter((path) => !allowedInKiosk(path));
    expect(leaked).toEqual([]);
    const business = modules.filter((path) => path.replace(/\\/g, '/').includes('/src/business/'));
    expect(business.map((p) => p.replace(/\\/g, '/').split('/src/')[1]).sort()).toEqual(['business/offline/offlineClock.ts', 'business/offline/zoneCache.ts']);
  });

  it('the two allowed business files import nothing', () => {
    for (const file of ['business/offline/zoneCache.ts', 'business/offline/offlineClock.ts']) {
      expect(importsOf(resolve(SRC, file))).toEqual([]);
    }
  });

  it('fails a bundle whose kiosk chunks carry React or manager code', () => {
    const chunk = (fileName: string, moduleIds: string[], imports: string[] = [], extra = {}): FenceItem =>
      ({ type: 'chunk', fileName, moduleIds, imports, dynamicImports: [], isEntry: false, name: fileName, ...extra });
    const bundle: Record<string, FenceItem> = {
      'kiosk.js': chunk('kiosk.js', ['/w/src/kiosk/main.ts', '/w/src/business/offline/zoneCache.ts'], ['shared.js'], { isEntry: true, name: 'kiosk' }),
      'shared.js': chunk('shared.js', ['/w/node_modules/react/index.js', '/w/src/business/console/Hq.tsx']),
      'main.js': chunk('main.js', ['/w/src/cloud/App.tsx'], [], { isEntry: true, name: 'main' }),
    };
    expect(forbiddenModules(bundle, 'kiosk')).toEqual(['/w/node_modules/react/index.js', '/w/src/business/console/Hq.tsx']);
  });
});
