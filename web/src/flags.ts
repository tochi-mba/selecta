import { createElement, Fragment, ReactNode, useSyncExternalStore } from 'react';
import app from '../../src/selecta/flags/app.json';
import core from '../../src/selecta/flags/core.json';
import discover from '../../src/selecta/flags/discover.json';
import editor from '../../src/selecta/flags/editor.json';
import learning from '../../src/selecta/flags/learning.json';
import library from '../../src/selecta/flags/library.json';
import listen from '../../src/selecta/flags/listen.json';
import lucy from '../../src/selecta/flags/lucy.json';
import mixes from '../../src/selecta/flags/mixes.json';
import moves from '../../src/selecta/flags/moves.json';
import mymixes from '../../src/selecta/flags/mymixes.json';
import requests from '../../src/selecta/flags/requests.json';
import tools from '../../src/selecta/flags/tools.json';
import workspace from '../../src/selecta/flags/workspace.json';

/** Feature flags, the site's side. The registry is the same JSON the server reads, so a flag's name
 * can't drift between the two, and a misspelt one doesn't compile. Which flags are on comes from the
 * server, in `/api/status`, already worked through what each needs. A server too old to say counts
 * every flag as on, which is what that server can do.
 *
 * A feature that's off is gone, as if it had never been built: no link, tab, button, shortcut,
 * command or word about it, and the page around it closes up. That is the whole contract, and the
 * browser sweep in `web/e2e/flags.e2e.ts` holds every page to it. */

const AREAS = [core, listen, mixes, lucy, mymixes, editor, moves, requests, discover, library, learning, workspace, app, tools];

export type FlagId =
  | keyof typeof core.flags | keyof typeof listen.flags | keyof typeof mixes.flags | keyof typeof lucy.flags
  | keyof typeof mymixes.flags | keyof typeof editor.flags | keyof typeof moves.flags | keyof typeof requests.flags
  | keyof typeof discover.flags | keyof typeof library.flags | keyof typeof learning.flags | keyof typeof workspace.flags
  | keyof typeof app.flags | keyof typeof tools.flags;

export type FlagSpec = {
  area: string;
  label: string;
  about: string;
  core?: string;
  requires?: string[];
  routes?: string[];
  surfaces?: string[];
  words?: string[];
  cli?: string[];
};

export const REGISTRY = Object.fromEntries(
  AREAS.flatMap((area) => Object.entries(area.flags).map(([id, spec]) => [id, { area: area.area, ...spec } as FlagSpec])),
) as Record<FlagId, FlagSpec>;

export const FLAG_IDS = Object.keys(REGISTRY) as FlagId[];

/** What the server said, or null before it has, or when it's too old to say. */
let current: Readonly<Record<string, boolean>> | null = null;
const listeners = new Set<() => void>();

/** From `/api/status`. Only a real change tells anyone, so the 4-second poll doesn't re-render. */
export function setFlags(next: Record<string, boolean> | undefined | null) {
  const value = next ?? null;
  if (JSON.stringify(value) === JSON.stringify(current)) return;
  current = value ? { ...value } : null;
  for (const listener of listeners) listener();
}

export function flagOn(id: FlagId): boolean {
  return current?.[id] !== false;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;

/** Re-renders when the flags change, which only happens when the server restarts with others. */
export function useFlags(): (id: FlagId) => boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return flagOn;
}

export function useFlag(id: FlagId): boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return flagOn(id);
}

/** What a thing needs to be shown: every flag in `flag`, and at least one of `anyFlag`. */
export type Gate = { flag?: FlagId | FlagId[]; anyFlag?: FlagId[] };

export function gateOpen(gate: Gate): boolean {
  const all = gate.flag === undefined ? [] : Array.isArray(gate.flag) ? gate.flag : [gate.flag];
  return all.every(flagOn) && (!gate.anyFlag || gate.anyFlag.some(flagOn));
}

/** Only the items whose features are on. Every list that drives the shell goes through this. */
export function visible<T extends Gate>(items: readonly T[]): T[] {
  return items.filter(gateOpen);
}

/** Its children, or nothing, so the region and whatever holds only it both go. */
export function Flag({ id, any, children }: { id?: FlagId | FlagId[]; any?: FlagId[]; children: ReactNode }) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return gateOpen({ flag: id, anyFlag: any }) ? createElement(Fragment, null, children) : null;
}
