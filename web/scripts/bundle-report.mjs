// S3-0073-06 build-size report: what the main page downloads first, and what loads later.
// Usage (from web/): node scripts/bundle-report.mjs <dist folder> [<baseline dist folder>]
// It reads index.html for the entry script and its modulepreloads, sizes every JavaScript chunk
// (raw and gzip), and fails if the player's own code is not in the entry chunk, so a split can
// never leave playback waiting on a page download.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Literal strings from web/src/player.ts that survive minification.
const PLAYER_MARKERS = [
  'Audio output changed. Press play to reconnect the sound.',
  'The sound was interrupted. Press play to carry on.',
];

function read(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entry = html.match(/<script[^>]+type="module"[^>]+src="\/?([^"]+)"/)?.[1];
  if (!entry) throw new Error(`${dist}/index.html has no module entry script`);
  const preloaded = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/?([^"]+)"/g)].map((m) => m[1]);
  const chunks = readdirSync(join(dist, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => {
      const bytes = readFileSync(join(dist, 'assets', name));
      return { name: `assets/${name}`, raw: bytes.length, gzip: gzipSync(bytes).length, text: bytes.toString('utf8') };
    })
    .sort((a, b) => b.raw - a.raw);
  const first = new Set([entry, ...preloaded]);
  const initial = chunks.filter((chunk) => first.has(chunk.name));
  const entryChunk = chunks.find((chunk) => chunk.name === entry);
  return {
    dist,
    entry,
    initialRaw: initial.reduce((sum, c) => sum + c.raw, 0),
    initialGzip: initial.reduce((sum, c) => sum + c.gzip, 0),
    playerInEntry: PLAYER_MARKERS.every((marker) => entryChunk?.text.includes(marker)),
    chunks,
    initial: initial.map((c) => c.name),
  };
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const [dist, baseline] = process.argv.slice(2);
if (!dist) {
  console.error('usage: node scripts/bundle-report.mjs <dist> [<baseline dist>]');
  process.exit(2);
}
const after = read(dist);
for (const report of [baseline && read(baseline), after].filter(Boolean)) {
  console.log(`\n${report.dist}: first download ${kb(report.initialRaw)} (gzip ${kb(report.initialGzip)}), entry ${report.entry}`);
  for (const c of report.chunks) {
    const tag = report.initial.includes(c.name) ? 'first' : 'later';
    console.log(`  ${tag.padEnd(5)} ${c.name.padEnd(44)} ${kb(c.raw).padStart(10)}  gzip ${kb(c.gzip).padStart(9)}`);
  }
  console.log(`  player code in the entry chunk: ${report.playerInEntry ? 'yes' : 'NO'}`);
}
if (baseline) {
  const before = read(baseline);
  const saved = before.initialRaw - after.initialRaw;
  const savedGzip = before.initialGzip - after.initialGzip;
  console.log(`\nfirst download: ${kb(before.initialRaw)} -> ${kb(after.initialRaw)} (${kb(saved)} less, gzip ${kb(savedGzip)} less)`);
}
if (!after.playerInEntry) {
  console.error('FAIL: the player is not in the entry chunk');
  process.exit(1);
}
