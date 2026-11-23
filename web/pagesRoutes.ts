// Cloudflare Pages deep links are not covered by Vite's local development rewrites.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_ENTRIES = ['index.html', 'guest.html', 'display.html', 'kiosk.html'] as const;
// Pages canonicalises every page.html to /page with a redirect. So a rewrite whose target ends in
// .html never arrives: for /r/:code it drops the room code, and for /display or /kiosk it loops
// forever (ERR_TOO_MANY_REDIRECTS), because Pages already serves those two at their clean paths.
const REWRITES = [
  ['/r/:code', '/guest'],
  ['/r/:code/', '/guest'],
] as const;

export function validatePagesRedirects(contents: string): string[] {
  const errors: string[] = [];
  const routes = new Map<string, string>();
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const words = line.split(/\s+/);
    if (words.length !== 3) {
      errors.push(`Invalid Cloudflare _redirects rule: ${line}`);
      continue;
    }
    const [from, to, status] = words;
    if (to.endsWith('.html')) errors.push(`Cloudflare rewrite to a .html target redirects or loops: ${line}`);
    if (routes.has(from)) errors.push(`Duplicate Cloudflare route: ${from}`);
    else routes.set(from, `${to} ${status}`);
  }
  for (const [from, to] of REWRITES) {
    if (routes.get(from) !== `${to} 200`) {
      errors.push(`Missing required Cloudflare rewrite: ${from} ${to} 200`);
    }
  }
  return errors;
}

export function validateCloudflarePagesBuild(outDir: string): string[] {
  const errors = PAGE_ENTRIES.filter((page) => !existsSync(join(outDir, page)))
    .map((page) => `Missing published HTML entry: ${page}`);
  const path = join(outDir, '_redirects');
  if (!existsSync(path)) return [...errors, 'Missing published Cloudflare _redirects'];
  return [...errors, ...validatePagesRedirects(readFileSync(path, 'utf8'))];
}
