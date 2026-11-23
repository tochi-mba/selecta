import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCloudflarePagesBuild, validatePagesRedirects } from '../../pagesRoutes';

const rules = readFileSync(new URL('../../public/_redirects', import.meta.url), 'utf8');

describe('Cloudflare Pages dedicated entry-point routes', () => {
  it('routes the guest path to its own entry and leaves display and kiosk to Pages', () => {
    expect(validatePagesRedirects(rules)).toEqual([]);
    expect(rules).not.toMatch(/^\/(display|kiosk)/m);
  });

  it('rejects a rewrite to a .html target, which made /display redirect forever on staging', () => {
    expect(validatePagesRedirects(`${rules}/display /display.html 200\n`)).toContain(
      'Cloudflare rewrite to a .html target redirects or loops: /display /display.html 200',
    );
  });

  it('rejects a guest route pointing at the SPA and duplicate route definitions', () => {
    const wrong = rules.replace('/r/:code /guest 200', '/r/:code /index.html 200');
    expect(validatePagesRedirects(wrong)).toContain(
      'Missing required Cloudflare rewrite: /r/:code /guest 200',
    );
    expect(validatePagesRedirects(rules + '/r/:code /guest 200\n')).toContain(
      'Duplicate Cloudflare route: /r/:code',
    );
  });

  it('rejects the .html target that redirects a room URL to /guest', () => {
    for (const suffix of ['', '/']) {
      const wrong = rules.replace(
        `/r/:code${suffix} /guest 200`,
        `/r/:code${suffix} /guest.html 200`,
      );
      expect(validatePagesRedirects(wrong)).toContain(
        `Missing required Cloudflare rewrite: /r/:code${suffix} /guest 200`,
      );
    }
  });

  it('fails missing publish assets, and accepts a complete output directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'selecta-pages-'));
    try {
      for (const entry of ['index.html', 'guest.html', 'display.html', 'kiosk.html']) {
        writeFileSync(join(directory, entry), '<!doctype html>');
      }
      expect(validateCloudflarePagesBuild(directory)).toContain('Missing published Cloudflare _redirects');
      writeFileSync(join(directory, '_redirects'), rules);
      expect(validateCloudflarePagesBuild(directory)).toEqual([]);
      unlinkSync(join(directory, 'guest.html'));
      expect(validateCloudflarePagesBuild(directory)).toContain('Missing published HTML entry: guest.html');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
