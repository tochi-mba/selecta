// Test-only localhost fixture server. Not a customer Cloud audio daemon.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.flac': 'audio/flac', '.opus': 'audio/ogg' };
const port = Number(process.env.SELECTA_BROWSER_QA_PORT ?? 5194);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid test port');
const pageRoot = resolve(ROOT, 'web/src/testsupport/browser');
const fixtureRoot = resolve(ROOT, 'web/node_modules/.cache/selecta-browser-qa');
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ready'); return; }
  const prefix = '/src/testsupport/browser/';
  let root;
  let name;
  if (url.pathname.startsWith(prefix)) { root = pageRoot; name = url.pathname.slice(prefix.length); }
  else if (url.pathname.startsWith('/fixtures/')) { root = fixtureRoot; name = url.pathname.slice(10); }
  else { res.writeHead(404); res.end(); return; }
  try {
    const path = resolve(root, decodeURIComponent(name));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log('[BROWSER-QA] synthetic lab http://127.0.0.1:' + port));
