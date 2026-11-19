import { describe, expect, it } from 'vitest';
import inventory from '../../../docs/adr/mp-0272-surface-inventory.json' with { type: 'json' };
import spec from '../../e2e/mp-baseline.mp.ts?raw';
import axeSpec from '../../e2e-cloud/bf-accessibility.cloud.ts?raw';
import { REGISTRY, type FlagId } from '../flags';
import { ALIASES, parseRoute, pathOf } from '../router';
import { DESTINATIONS, exploreTabs, workspaceTabs } from './manifest';

/** MP-0272-01: every route, persistent surface and overlay has a source owner, a fixture ID and a
 * state denominator in docs/adr/mp-0272-surface-inventory.json. A new page, tab, overlay or flag
 * surface without an entry fails here, so the inventory cannot quietly fall behind the source. */

// Every source file under web/src, as text, keyed the way the inventory names it (web/src/...).
const SOURCES = Object.fromEntries(
  Object.entries(import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }))
    .map(([key, text]) => [`web/src/${key.replace(/^\.\.\//, '').replace(/^\.\//, 'shell/')}`, text]),
);
const DRIVERS: Record<string, string> = { 'web/e2e/mp-baseline.mp.ts': spec, 'web/e2e-cloud/bf-accessibility.cloud.ts': axeSpec };
const read = (path: string) => SOURCES[path] ?? DRIVERS[path];

type Entry = { id: string; owner: string | string[]; fixtureId: string; states: string[]; denominator: number; measured: string[]; flagSurface?: string };
const routes = inventory.routes as (Entry & { path: string })[];
const persistent = inventory.persistent as (Entry & { selector: string })[];
const overlays = inventory.overlays as (Entry & { kind: string; title: string })[];
const fixtures = inventory.fixtures as Record<string, { about: string; driver: string | null; gap?: string }>;
const everything: Entry[] = [...routes, ...persistent, ...overlays];
type SiteEntry = { id: string; site: string; path: string; owner: string[]; states: string[]; denominator: number; axe: string | null; gap?: string };
const sites = inventory.sites as unknown as { surfaces: SiteEntry[]; overlays: { id: string; title: string; kind: string; owner: string }[] };
/** The other sites' source folders (BF overhaul W6): their surfaces and overlays live under `sites`. */
const SITE_DIRS = ['web/src/cloud/', 'web/src/admin/', 'web/src/business/', 'web/src/guest/', 'web/src/display/'];
const inSite = (file: string) => SITE_DIRS.some((dir) => file.startsWith(dir));
/** JSX that opens an overlay; `useState<Workspace | null>` is a type, not a Workspace overlay. */
const OPENS = /(?<![\w$.])<(Dialog|Drawer|Workspace|Sheet)(\s|>|$)/gm;
const owners = (entry: Entry) => (Array.isArray(entry.owner) ? entry.owner : [entry.owner]);
const routeKey = (path: string) => JSON.stringify(parseRoute(path));

describe('MP-0272 surface inventory', () => {
  it('every entry names an owner that exists, a known fixture and an honest state denominator', () => {
    const ids = new Set<string>();
    for (const entry of everything) {
      expect(ids.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
      ids.add(entry.id);
      expect(owners(entry).length, entry.id).toBeGreaterThan(0);
      for (const owner of owners(entry)) expect(read(owner), `${entry.id} owner ${owner}`).toBeTypeOf('string');
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
      expect(read(fixture.driver) ?? '', `${fixture.driver} never names ${id}`).toContain(`'${id}'`);
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
    for (const [file, text] of Object.entries(SOURCES)) {
      // Plain .ts files can contain generic types such as list<Workspace>.
      // Only TSX can contain JSX overlay elements.
      if (!file.endsWith('.tsx')) continue;
      if (inventory.outOfScope.some((scope) => file.startsWith(`${scope.path}/`))) continue;
      const opens = (text.match(OPENS) ?? []).length + (text.match(/role="alertdialog"/g) ?? []).length;
      if (opens) counted.set(file, opens);
    }
    expect(counted.size).toBeGreaterThan(5);
    for (const [file, opens] of counted) {
      const listed = inSite(file)
        ? sites.overlays.filter((overlay) => overlay.owner === file).length
        : overlays.filter((overlay) => owners(overlay).includes(file)).length;
      expect(listed, `${file} opens ${opens} overlays, inventory lists ${listed}`).toBe(opens);
    }
    for (const overlay of sites.overlays) expect(inSite(overlay.owner), `${overlay.id} belongs in the local overlays`).toBe(true);
  });

  it('enumerates the Cloud, admin, business, guest and display surfaces, each checked by axe or saying why not', () => {
    expect(inventory.outOfScope.map((scope) => scope.path)).toEqual(['web/src/harness']);
    const ids = new Set<string>();
    for (const entry of sites.surfaces) {
      expect(ids.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
      ids.add(entry.id);
      for (const owner of entry.owner) expect(read(owner), `${entry.id} owner ${owner}`).toBeTypeOf('string');
      expect(entry.denominator, entry.id).toBe(entry.states.length);
      for (const state of entry.states) expect(inventory.states, `${entry.id} state ${state}`).toContain(state);
      if (entry.axe === null) expect(entry.gap?.length ?? 0, `${entry.id} has no axe spec and no reason`).toBeGreaterThan(30);
      else expect(read(entry.axe) ?? '', `${entry.axe} never checks ${entry.id}`).toContain(`'${entry.id}'`);
    }
    for (const site of ['cloud', 'admin', 'business', 'guest', 'display']) expect(sites.surfaces.some((entry) => entry.site === site), site).toBe(true);
    // every Cloud page and every staff console page the source can show has a surface
    const cloudPages = /export type Page = ([^;]+);/.exec(read('web/src/cloud/api.ts'))![1].match(/'([a-z]+)'/g)!.map((page) => page.slice(1, -1));
    const cloudIds = { home: 'site.cloud.home', listen: 'site.cloud.listen', library: 'site.cloud.library', uploads: 'site.cloud.uploads', billing: 'site.cloud.billing', settings: 'site.cloud.settings' } as Record<string, string>;
    for (const page of cloudPages) expect(ids, `Cloud page ${page}`).toContain(cloudIds[page]);
    const adminPages = /export type AdminPage = ([^;]+);/.exec(read('web/src/admin/AdminArea.tsx'))![1].match(/'([a-z]+)'/g)!.map((page) => page.slice(1, -1));
    for (const page of adminPages) expect(ids, `admin page ${page}`).toContain(`site.admin.${page}`);
  });

  it('covers every local surface a feature flag names', () => {
    const named = new Set(everything.map((entry) => entry.flagSurface).filter(Boolean));
    const surfaces = new Set(
      (Object.keys(REGISTRY) as FlagId[]).flatMap((id) => REGISTRY[id].surfaces ?? []).filter((surface) => !surface.startsWith('cloud.')),
    );
    for (const surface of surfaces) expect(named, `flag surface ${surface}`).toContain(surface);
  });
});
