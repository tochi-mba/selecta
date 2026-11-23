import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCloudflarePagesBuild, validatePagesRedirects } from '../../pagesRoutes';

const rules = readFileSync(new URL('../../public/_redirects', import.meta.url), 'utf8');

describe('Cloudflare Pages dedicated entry-point routes', () => {
  it('routes the guest, display and kiosk paths to their own HTML entries', () => {
    expect(validatePagesRedirects(rules)).toEqual([]);
  });

  it('rejects a guest route pointing at the SPA and duplicate route definitions', () => {
    const wrong = rules.replace('/r/:code /guest.html 200', '/r/:code /index.html 200');
    expect(validatePagesRedirects(wrong)).toContain(
      'Missing required Cloudflare rewrite: /r/:code /guest.html 200',
    );
    expect(validatePagesRedirects(rules + '/r/:code /guest.html 200\n')).toContain(
      'Duplicate Cloudflare route: /r/:code',
    );
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
