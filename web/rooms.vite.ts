// The Rooms pages beside the app: the guest page (/r/{code}) and the big-screen display
// (/display) are separate, tiny entries so a phone at a party never downloads the whole app.
//
// - `roomPages()` adds both HTML entries to the build, serves them at their real paths in
//   development, and fails the build if the guest page's JavaScript (its entry and every chunk
//   it loads) passes 100 KB, uncompressed, so gzip can't hide growth.
// - With SELECTA_CLOUD_E2E=1 it also builds the cloud browser-test harness page, which never
//   ships otherwise.
//
// A static host must answer /r/* with guest.html and /display with display.html.

import { resolve } from 'node:path';
import type { OutputBundle, OutputChunk } from 'rollup';
import type { Plugin } from 'vite';

export const GUEST_JS_LIMIT = 100 * 1024;

export function jsBytesFor(bundle: OutputBundle, entryName: string): number {
  const chunks = Object.values(bundle).filter((item): item is OutputChunk => item.type === 'chunk');
  const entry = chunks.find((chunk) => chunk.isEntry && chunk.name === entryName);
  if (!entry) throw new Error(`No entry chunk is named ${entryName}`);
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const chunk = bundle[name];
    if (chunk?.type === 'chunk') [...chunk.imports, ...chunk.dynamicImports].forEach(walk);
  };
  walk(entry.fileName);
  return [...seen].reduce((total, name) => {
    const chunk = bundle[name];
    return total + (chunk?.type === 'chunk' ? Buffer.byteLength(chunk.code) : 0);
  }, 0);
}

export function roomPages(root: string): Plugin {
  return {
    name: 'selecta-room-pages',
    config(_config, env) {
      if (env.command !== 'build') return;
      const input: Record<string, string> = {
        main: resolve(root, 'index.html'),
        guest: resolve(root, 'guest.html'),
        display: resolve(root, 'display.html'),
      };
      if (process.env.SELECTA_CLOUD_E2E === '1') input.harness = resolve(root, 'cloud-harness.html');
      return { build: { rollupOptions: { input } } };
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (/^\/r\/[^/]+\/?$/.test(path)) req.url = '/guest.html';
        else if (path === '/display' || path === '/display/') req.url = '/display.html';
        next();
      });
    },
    generateBundle(_options, bundle) {
      const bytes = jsBytesFor(bundle, 'guest');
      if (bytes > GUEST_JS_LIMIT) {
        this.error(`The guest page loads ${bytes} bytes of JavaScript; the limit is ${GUEST_JS_LIMIT} (SC-0416-02).`);
      }
      this.emitFile({ type: 'asset', fileName: 'guest-size.json', source: JSON.stringify({ guest_js_bytes: bytes, limit: GUEST_JS_LIMIT }) });
    },
  };
}
