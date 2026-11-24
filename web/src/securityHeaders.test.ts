import { describe, expect, it } from 'vitest';

/** Gap 7: the site's security headers (web/public/_headers). The report-only policy allows the
 * one inline script in index.html by its hash, so a change to that script must change the hash. */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
type Crypto = { createHash(kind: string): { update(text: string): { digest(form: string): string } } };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const crypto = node.getBuiltinModule('node:crypto') as Crypto;
const headers = fs.readFileSync(`${node.cwd()}/public/_headers`, 'utf8');
const policy = headers.match(/Content-Security-Policy-Report-Only: (.+)/)?.[1] ?? '';

describe('security headers', () => {
  it('allows exactly the inline scripts each page has, by hash', () => {
    // any case, any attributes, any spacing before the closing >; a script with src= is not inline
    for (const page of ['index.html', 'guest.html', 'kiosk.html', 'display.html']) {
      const html = fs.readFileSync(`${node.cwd()}/${page}`, 'utf8').replace(/\r\n/g, '\n');
      for (const [, body] of html.matchAll(/<scriptb(?![^>]*bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        const hash = crypto.createHash('sha256').update(body).digest('base64');
        expect(policy, `${page} has an inline script whose hash is not in _headers`).toContain(`'sha256-${hash}'`);
      }
    }
  });

  it('keeps the enforced basics and sends HSTS and a permissions policy', () => {
    expect(headers).toMatch(/^ {2}Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'$/m);
    for (const part of ["default-src 'self'", 'connect-src', 'media-src', 'blob:', 'worker-src', "frame-ancestors 'none'"]) expect(policy).toContain(part);
    expect(policy).not.toContain("'unsafe-eval'");
    expect(headers).toMatch(/Strict-Transport-Security: max-age=\d{8,}/);
    expect(headers).toMatch(/Permissions-Policy: .*camera=\(\).*microphone=\(\)/);
  });
});
