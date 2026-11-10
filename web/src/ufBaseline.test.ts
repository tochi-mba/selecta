import { describe, expect, it } from 'vitest';
import { ALIASES, parseRoute, pathOf } from './router';

/** UF-0366-01: the route inventory recorded in ADR-0366 is the router's, address for address. Every
 * listed address opens a real page and round-trips, every alias the router keeps is listed, and every
 * page kind the router knows has a row. */

const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const adr = fs.readFileSync(`${node.cwd()}/../docs/adr/adr-0366-unified-finish-charter-and-parity.md`, 'utf8');
const section = adr.slice(adr.indexOf('**Source baseline (UF-0366-01).**'), adr.indexOf('**Old programme owners'));
const rows = [...section.matchAll(/^\| `([^`]+)` \| (\w+)/gm)].map(([, address, page]) => ({ address, page }));
const example = (address: string) => address.replace('<id>', '7').replace('<tab>', 'storage');

describe('UF-0366-01 baseline route inventory', () => {
  it('records the planning SHA and lists the routes', () => {
    expect(section).toContain('f17944530d54203e49baebdabc08a57ee9f40526');
    expect(rows.length).toBeGreaterThanOrEqual(14);
  });

  it('every listed address opens the page it says and round-trips', () => {
    for (const { address, page } of rows) {
      const route = parseRoute(example(address));
      expect(route.page, address).toBe(page);
      expect(parseRoute(pathOf(route)), address).toEqual(route);
    }
  });

  it('every alias is listed and every page kind has a row', () => {
    for (const alias of Object.keys(ALIASES)) expect(section, alias).toContain(`\`${alias}\``);
    const pages = new Set(rows.map((row) => row.page));
    for (const page of ['mixes', 'lucy', 'edit', 'listen', 'library', 'discover', 'workshop', 'listening']) expect(pages, page).toContain(page);
    expect(parseRoute('/no-such-page').page).toBe('missing');
  });
});
