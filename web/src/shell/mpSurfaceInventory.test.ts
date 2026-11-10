import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import inventory from '../../../docs/adr/mp-0272-surface-inventory.json' with { type: 'json' };
import { REGISTRY, type FlagId } from '../flags';
import { ALIASES, parseRoute, pathOf } from '../router';
import { DESTINATIONS, exploreTabs, workspaceTabs } from './manifest';

/** MP-0272-01: every route, persistent surface and overlay has a source owner, a fixture ID and a
 * state denominator in docs/adr/mp-0272-surface-inventory.json. A new page, tab, overlay or flag
 * surface without an entry fails here, so the inventory cannot quietly fall behind the source. */

// vitest runs from web/, under jsdom, where import.meta.url is not a file URL
const ROOT = resolve(process.cwd(), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

type Entry = { id: string; owner: string | string[]; fixtureId: string; states: string[]; denominator: number; measured: string[]; flagSurface?: string };
const routes = inventory.routes as (Entry & { path: string })[];
const persistent = inventory.persistent as (Entry & { selector: string })[];
const overlays = inventory.overlays as (Entry & { kind: string; title: string })[];
const fixtures = inventory.fixtures as Record<string, { about: string; driver: string | null; gap?: string }>;
const everything: Entry[] = [...routes, ...persistent, ...overlays];
const owners = (entry: Entry) => (Array.isArray(entry.owner) ? entry.owner : [entry.owner]);
const routeKey = (path: string) => JSON.stringify(parseRoute(path));

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('MP-0272 surface inventory', () => {
  it('every entry names an owner that exists, a known fixture and an honest state denominator', () => {
    const ids = new Set<string>();
    for (const entry of everything) {
      expect(ids.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
      ids.add(entry.id);
      expect(owners(entry).length, entry.id).toBeGreaterThan(0);
      for (const owner of owners(entry)) expect(existsSync(join(ROOT, owner)), `${entry.id} owner ${owner}`).toBe(true);
      expect(fixtures[entry.fixtureId], `${entry.id} fixture ${entry.fixtureId}`).toBeDefined();
      expect(entry.states.length, entry.id).toBeGreaterThan(0);
      expect(entry.denominator, `${entry.id} denominator`).toBe(entry.states.length);
      for (const state of [...entry.states, ...entry.measured]) expect(inventory.states, `${entry.id} state ${state}`).toContain(state);
      for (const state of entry.measured) expect(entry.states, `${entry.id} measures ${state} outside its denominator`).toContain(state);
    }
  });

  it('every fixture is either driven by a spec that names it or carries the reason it is not', () => {
    for (const [id, fixture] of Object.entries(fixtures)) {
      if (fixture.driver === null) {
        expect(fixture.gap, `${id} has no driver and no gap`).toBeTruthy();
        continue;
      }
      expect(read(fixture.driver), `${fixture.driver} never names ${id}`).toContain(`'${id}'`);
    }
    for (const entry of everything) {
      if (entry.measured.length) expect(fixtures[entry.fixtureId].driver, `${entry.id} claims measured states without a driver`).not.toBeNull();
    }
  });

  it('covers every page and tab the router can produce', () => {
    const covered = new Set(routes.map((route) => routeKey(route.path)));
    const router = read('web/src/router.ts');
    const pages = new Set([...router.matchAll(/page: '([a-z]+)'/g)].map((match) => match[1]));
    const coveredPages = new Set(routes.map((route) => parseRoute(route.path).page));
    for (const page of pages) expect(coveredPages, `router page ${page}`).toContain(page);
    const tabs = /WorkshopTab = ([^;]+);/.exec(router)![1].match(/'([a-z]+)'/g)!.map((tab) => tab.slice(1, -1));
    for (const tab of tabs) expect(covered, `workshop tab ${tab}`).toContain(routeKey(tab === 'overview' ? '/workshop' : `/workshop/${tab}`));
    for (const target of Object.values(ALIASES)) expect(covered, `alias target ${target}`).toContain(routeKey(target));
  });

  it('covers every destination and tab in the navigation manifest', () => {
    const covered = new Set(routes.map((route) => routeKey(route.path)));
    for (const item of [...DESTINATIONS, ...exploreTabs(), ...workspaceTabs()]) expect(covered, `manifest ${item.path}`).toContain(routeKey(item.path));
    for (const route of routes) {
      const parsed = parseRoute(route.path);
      expect(parsed.page === 'missing', `${route.id} ${route.path}`).toBe(route.id === 'route.missing');
      expect(pathOf(parsed), `${route.id} is the canonical address`).toBe(route.path);
    }
  });

  it('covers every overlay the source opens', () => {
    const counted = new Map<string, number>();
    for (const file of sourceFiles('web/src')) {
      if (inventory.outOfScope.some((scope) => file.startsWith(`${scope.path}/`))) continue;
      const text = read(file);
      const opens = (text.match(/<(Dialog|Drawer|Workspace|Sheet)(\s|>|$)/gm) ?? []).length + (text.match(/role="alertdialog"/g) ?? []).length;
      if (opens) counted.set(file, opens);
    }
    expect(counted.size).toBeGreaterThan(5);
    for (const [file, opens] of counted) {
      const listed = overlays.filter((overlay) => owners(overlay).includes(file)).length;
      expect(listed, `${relative(ROOT, join(ROOT, file))} opens ${opens} overlays, inventory lists ${listed}`).toBe(opens);
    }
  });

  it('covers every local surface a feature flag names', () => {
    const named = new Set(everything.map((entry) => entry.flagSurface).filter(Boolean));
    const surfaces = new Set(
      (Object.keys(REGISTRY) as FlagId[]).flatMap((id) => REGISTRY[id].surfaces ?? []).filter((surface) => !surface.startsWith('cloud.')),
    );
    for (const surface of surfaces) expect(named, `flag surface ${surface}`).toContain(surface);
  });
});
