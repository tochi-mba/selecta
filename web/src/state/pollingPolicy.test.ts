import { describe, expect, it } from 'vitest';
import { CACHE_OWNERS, POLLING } from './pollingPolicy';

/**
 * T0068 (ADR-0005): the polling policy and the typed client are enforced from the source, so a new
 * timer, poll or direct server call can't appear without being written into pollingPolicy.ts.
 */
// Same disk access as importBoundaries.test.ts: the app's tsconfig has no Node types.
type Fs = {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { recursive: true }): string[];
  existsSync(path: string): boolean;
};
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;

const files = fs.readdirSync(SOURCE, { recursive: true })
  .map((name) => name.replace(/\\/g, '/'))
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.startsWith('test/'));
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8');

const TIMER = /window\.setInterval\(|\buseVisiblePoll\(|\bevery:\s*[\w\d]/;
// Separate apps with their own origin and client (admin, cloud, rooms, the harness, the runtime
// probe), plus audio players handed a ready-made URL: none of them is a page of the local app.
const OWN_CLIENTS = [
  'RuntimeApp.tsx', 'admin/adminApi.ts', 'api.ts', 'cloud/CloudApp.tsx',
  'devices/audioSpeaker.ts', 'harness/main.tsx', 'rooms/dom.ts', 'studio.ts',
];

describe('polling policy (T0068)', () => {
  it('lists every file that starts a timer or a poll', () => {
    const listed = new Set(POLLING.map((rule) => rule.file));
    const unlisted = files.filter((file) => TIMER.test(read(file)) && !listed.has(file));
    expect(unlisted).toEqual([]);
  });

  it('every listed file exists and still has the timer it is listed for', () => {
    const stale = POLLING.filter((rule) => !fs.existsSync(SOURCE + rule.file) || !TIMER.test(read(rule.file)));
    expect(stale.map((rule) => rule.file)).toEqual([]);
  });

  it('a timer that keeps reading the server while the tab is hidden says why', () => {
    for (const rule of POLLING.filter((r) => r.hidden === 'continues')) expect(rule.why.length).toBeGreaterThan(10);
  });

  it('each shared piece of server data has exactly one owner', () => {
    const resources = CACHE_OWNERS.map((owner) => owner.resource);
    expect(new Set(resources).size).toBe(resources.length);
    for (const owner of CACHE_OWNERS) expect(fs.existsSync(SOURCE + owner.owner)).toBe(true);
  });

  it('only api.ts and the separate clients call fetch', () => {
    const direct = files.filter((file) => /(?<![\w.])fetch\(/.test(read(file).replace(/typeof fetch/g, '')));
    expect(direct.filter((file) => !OWN_CLIENTS.includes(file))).toEqual([]);
  });
});
