import { describe, expect, it } from 'vitest';
import inventory from '../../../docs/adr/mp-0272-surface-inventory.json' with { type: 'json' };
import cloudSweep from '../../e2e-cloud/layout-sweep.cloud.ts?raw';
import localSweep from '../../e2e/layout-sweep.e2e.ts?raw';
import { DESTINATIONS, MORE_DESTINATIONS } from './manifest';

/** Plan "two places", phase 1: every route and surface the inventory lists, and every place in the
 * navigation, is drawn by a layout sweep at phone to wide widths, or the sweep says in SKIPPED why
 * not. A new page without either fails here, so the sweep cannot quietly fall behind. */

/** The `'id': 'reason'` pairs of a sweep's SKIPPED table. */
function skipped(spec: string): Map<string, string> {
  const table = /const SKIPPED: Record<string, string> = \{([\s\S]*?)\n\};/.exec(spec);
  expect(table, 'the sweep has a SKIPPED table').not.toBeNull();
  return new Map([...table![1].matchAll(/'([^']+)':\s*'([^']*)'/g)].map((match) => [match[1], match[2]]));
}

/** The ids a sweep draws: every quoted id outside its SKIPPED table. */
function swept(spec: string): string {
  return spec.replace(/const SKIPPED: Record<string, string> = \{[\s\S]*?\n\};/, '');
}

const routes = inventory.routes as { id: string; path: string }[];
const surfaces = (inventory.sites as unknown as { surfaces: { id: string; site: string }[] }).surfaces;

describe('layout sweep coverage', () => {
  it('sweeps every local route in the inventory, or says why not', () => {
    const skips = skipped(localSweep);
    const drawn = swept(localSweep);
    for (const route of routes) {
      const reason = skips.get(route.id);
      if (reason !== undefined) expect(reason.length, `${route.id} is skipped without a reason`).toBeGreaterThan(30);
      else expect(drawn, `route ${route.id} (${route.path}) has no sweep entry`).toContain(`'${route.id}'`);
    }
  });

  it('sweeps every Cloud, guest, display, business and staff surface in the inventory, or says why not', () => {
    const skips = skipped(cloudSweep);
    const drawn = swept(cloudSweep);
    for (const surface of surfaces) {
      const reason = skips.get(surface.id);
      if (reason !== undefined) expect(reason.length, `${surface.id} is skipped without a reason`).toBeGreaterThan(30);
      else expect(drawn, `surface ${surface.id} has no sweep entry`).toContain(`'${surface.id}'`);
    }
  });

  it('sweeps every place in the Cloud navigation, and every destination in the local app', () => {
    const drawn = swept(cloudSweep);
    for (const place of [...DESTINATIONS, ...MORE_DESTINATIONS]) expect(drawn, `Cloud place ${place.id} ${place.path}`).toContain(`'${place.path}'`);
    for (const place of DESTINATIONS) expect(swept(localSweep), `local destination ${place.path}`).toContain(`'${place.path}'`);
  });

  it('skips nothing that is not in the inventory', () => {
    const known = new Set([...routes.map((route) => route.id), ...surfaces.map((surface) => surface.id)]);
    for (const id of [...skipped(localSweep).keys(), ...skipped(cloudSweep).keys()]) expect(known, `SKIPPED names ${id}`).toContain(id);
  });
});
