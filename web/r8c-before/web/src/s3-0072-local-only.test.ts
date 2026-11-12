import { describe, expect, it } from 'vitest';

/**
 * ADR-0072 (S3-0072-08), the part that needs no browser: nothing the page ships can reach past this
 * computer on its own. No source file names a remote host, every request the local app makes is a
 * same-origin path, and the page shell, manifest and stylesheets load nothing from elsewhere. The
 * browser half, which watches every request during first run, navigation, playback and a preview,
 * is web/e2e/s3-0072-local-requests.e2e.ts.
 */

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const styles = import.meta.glob('./**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const shell = import.meta.glob('../index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const manifest = import.meta.glob('../public/manifest.webmanifest', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// XML namespaces are identifiers, not requests; the localhost example is placeholder text in Lucy's settings.
const allowed = /^https?:\/\/(www\.w3\.org|localhost)(?=[:/'"`\s]|$)/;

const remoteHosts = (text: string) => [...text.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)].map((match) => match[0]).filter((url) => !allowed.test(url));

describe('S3-0072-08 nothing the page ships reaches past this computer', () => {
  it('reads the sources, styles, page shell and manifest', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(styles).length).toBeGreaterThan(3);
    expect(Object.keys(shell)).toHaveLength(1);
    expect(Object.keys(manifest)).toHaveLength(1);
  });

  it('no source file or stylesheet names a remote host', () => {
    const found = Object.entries({ ...sources, ...styles }).flatMap(([file, text]) => remoteHosts(text).map((url) => `${file}: ${url}`));
    expect(found).toEqual([]);
  });

  it('every request the local app makes is a same-origin path', () => {
    // the local app's own fetches; cloud, rooms and admin take an origin set at build time and are not the local app
    const local = Object.entries(sources).filter(([file]) => !/^\.\/(cloud|rooms|admin)\//.test(file));
    const calls = local.flatMap(([file, text]) =>
      [...text.matchAll(/\b(?:fetch|new EventSource|navigator\.sendBeacon)\(\s*([`'"])([^`'"]*)/g)].map((match) => ({ file, start: match[2] })));
    // T0068 moved the raw byte fetches (audio, seam clips, backups, listening events) behind api.ts's
    // fetchBytes, which prefixes /api itself, so its callers must pass a rooted path
    const viaHelper = local.flatMap(([file, text]) =>
      [...text.matchAll(/\bfetchBytes\(\s*([`'"])([^`'"]*)/g)].map((match) => ({ file, start: match[2] })));
    expect(calls.length + viaHelper.length).toBeGreaterThan(8);
    expect(viaHelper.length).toBeGreaterThan(2);
    expect(/fetchBytes = \(path: string, init\?: RequestInit\): Promise<Response> =>\s*init \? fetch\(`\/api\$\{path\}`, init\) : fetch\(`\/api\$\{path\}`\)/.test(local.find(([file]) => file === './api.ts')?.[1] ?? '')).toBe(true);
    const offsite = calls.filter(({ start }) => start !== '' && !start.startsWith('/') && !start.startsWith('${apiOrigin}'));
    expect(offsite).toEqual([]);
    expect(viaHelper.filter(({ start }) => !start.startsWith('/'))).toEqual([]);
    // where an origin prefix is used, it defaults to this page's own origin unless a build sets it
    for (const [file, text] of local) {
      if (/\$\{apiOrigin\}/.test(text)) expect(text, file).toMatch(/apiOrigin = \(import\.meta\.env\.VITE_SELECTA_API_ORIGIN \?\? ''\)/);
    }
  });

  it('the page shell and installed-app manifest load only local files or inline data', () => {
    const page = Object.values(shell)[0];
    const references = [...page.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    expect(references.length).toBeGreaterThan(2);
    expect(references.filter((reference) => !reference.startsWith('/') && !reference.startsWith('data:'))).toEqual([]);
    const app = JSON.parse(Object.values(manifest)[0]) as { start_url: string; scope: string; icons: { src: string }[] };
    expect(app.start_url).toBe('/');
    expect(app.scope).toBe('/');
    expect(app.icons.every((icon) => icon.src.startsWith('/'))).toBe(true);
  });

  it('no stylesheet imports a font or sheet from elsewhere', () => {
    const imports = Object.entries(styles).flatMap(([file, text]) =>
      [...text.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/g)].map((match) => `${file}: ${match[1]}`));
    expect(imports.filter((entry) => /https?:|\/\//.test(entry))).toEqual([]);
  });
});
