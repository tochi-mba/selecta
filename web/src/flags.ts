import { createElement, Fragment, ReactNode, useSyncExternalStore } from 'react';
import app from '../../src/selecta/flags/app.json' with { type: 'json' };
import autopilot from '../../src/selecta/flags/autopilot.json' with { type: 'json' };
import business from '../../src/selecta/flags/business.json' with { type: 'json' };
import cloud from '../../src/selecta/flags/cloud.json' with { type: 'json' };
import cloudAdmin from '../../src/selecta/flags/cloud_admin.json' with { type: 'json' };
import cloudRooms from '../../src/selecta/flags/cloud_rooms.json' with { type: 'json' };
import cloudShell from '../../src/selecta/flags/cloud_shell.json' with { type: 'json' };
import core from '../../src/selecta/flags/core.json' with { type: 'json' };
import discover from '../../src/selecta/flags/discover.json' with { type: 'json' };
import editor from '../../src/selecta/flags/editor.json' with { type: 'json' };
import learning from '../../src/selecta/flags/learning.json' with { type: 'json' };
import library from '../../src/selecta/flags/library.json' with { type: 'json' };
import listen from '../../src/selecta/flags/listen.json' with { type: 'json' };
import lucy from '../../src/selecta/flags/lucy.json' with { type: 'json' };
import mixes from '../../src/selecta/flags/mixes.json' with { type: 'json' };
import moves from '../../src/selecta/flags/moves.json' with { type: 'json' };
import mymixes from '../../src/selecta/flags/mymixes.json' with { type: 'json' };
import requests from '../../src/selecta/flags/requests.json' with { type: 'json' };
import tools from '../../src/selecta/flags/tools.json' with { type: 'json' };
import venueops from '../../src/selecta/flags/venueops.json' with { type: 'json' };
import workspace from '../../src/selecta/flags/workspace.json' with { type: 'json' };

/** Feature flags, the site's side. The registry is the same JSON the server reads, so a flag's name
 * can't drift between the two, and a misspelt one doesn't compile. Which flags are on comes from the
 * server, in `/api/status`, already worked through what each needs. A server too old to say counts
 * every flag as on, which is what that server can do.
 *
 * A feature that's off is gone, as if it had never been built: no link, tab, button, shortcut,
 * command or word about it, and the page around it closes up. That is the whole contract, and the
 * browser sweep in `web/e2e/flags.e2e.ts` holds every page to it. */

const AREAS = [core, listen, mixes, lucy, mymixes, editor, moves, requests, discover, library, learning, workspace, app, tools, cloud, cloudRooms, cloudAdmin, cloudShell, autopilot, venueops, business];

export type FlagId =
  | keyof typeof core.flags | keyof typeof listen.flags | keyof typeof mixes.flags | keyof typeof lucy.flags
  | keyof typeof mymixes.flags | keyof typeof editor.flags | keyof typeof moves.flags | keyof typeof requests.flags
  | keyof typeof discover.flags | keyof typeof library.flags | keyof typeof learning.flags | keyof typeof workspace.flags
  | keyof typeof app.flags | keyof typeof tools.flags | keyof typeof cloud.flags | keyof typeof cloudRooms.flags
  | keyof typeof cloudAdmin.flags | keyof typeof cloudShell.flags | keyof typeof autopilot.flags | keyof typeof venueops.flags | keyof typeof business.flags;

export type FlagSpec = {
  area: string;
  label: string;
  about: string;
  core?: string;
  requires?: string[];
  routes?: string[];
  surfaces?: string[];
  cloud_surface_kind?: "headless" | "unreleased" | "rehearsal" | "operations";
  cloud_surface_reason?: string;
  words?: string[];
  cli?: string[];
};

export const REGISTRY = Object.fromEntries(
  AREAS.flatMap((area) => Object.entries(area.flags).map(([id, spec]) => [id, { area: area.area, ...spec } as FlagSpec])),
) as Record<FlagId, FlagSpec>;

export const FLAG_IDS = Object.keys(REGISTRY) as FlagId[];

/** What the server said, or null before it has, or when it's too old to say. */
let current: Readonly<Record<string, boolean>> | null = null;
/** Whether the server has said yet. Until it has, anything that would ask it about a feature waits. */
let heard = false;
/** Cloud only (ADR-0462, BF-0462-03): this account's decided features from /api/account, or null.
 * Local mode never sets it, so local flags read exactly as before. */
let account: Readonly<Record<string, boolean>> | null = null;
const listeners = new Set<() => void>();

/** From `/api/status`. Only a real change tells anyone, so the 4-second poll doesn't re-render.
 * `null` forgets what was heard, for tests; `undefined` is an older server that doesn't say. */
export function setFlags(next: Record<string, boolean> | undefined | null) {
  const value = next ?? null;
  // an account's features (Cloud) still count as heard when the status source forgets
  const nowHeard = next !== null || account !== null;
  if (JSON.stringify(value) === JSON.stringify(current) && nowHeard === heard) return;
  current = value ? { ...value } : null;
  heard = nowHeard;
  for (const listener of listeners) listener();
}

/** One flag read in both modes (ADR-0462): Cloud feeds the account's features snapshot here on
 * every account load and refresh (after each `flags.changed`), and `flagOn`, `Gate`, `useFlags`
 * and the shell then gate on it exactly as they gate on /api/status locally. A flag the account
 * does not mention is on, as Cloud's pages always read it. `null` forgets them (sign-out, unmount). */
export function setAccountFeatures(features: Record<string, boolean> | null) {
  if (JSON.stringify(features) === JSON.stringify(account)) return;
  account = features ? { ...features } : null;
  heard = current !== null || account !== null;
  for (const listener of listeners) listener();
}

/** On, and known to be: for work that asks the server something, which mustn't start on a guess. */
export function useFlagHeard(id: FlagId): boolean {
  useSyncExternalStore(subscribe, () => heard && flagOn(id), () => heard && flagOn(id));
  return heard && flagOn(id);
}

/** The one rule both sources follow: a flag the decisions do not mention is on. */
export function decidedOn(decisions: Readonly<Record<string, boolean>> | null | undefined, id: FlagId): boolean {
  return decisions?.[id] !== false;
}

export function flagOn(id: FlagId): boolean {
  return decidedOn(current, id) && decidedOn(account, id);
}

/** On, and named as on by a source that has spoken. For new work that sends something: a server
 * too old to know the flag mentions nothing, which `flagOn` reads as on. */
export function flagListed(id: FlagId): boolean {
  return flagOn(id) && (current?.[id] === true || account?.[id] === true);
}

/** The account source of the one read (BF-0462-03): what this account's plan and rules decide,
 * without what the open shell can run here. For a Cloud page that describes the account (plan
 * cards, allowance meters) or is handed an account snapshot: pass that snapshot's `features`, or
 * nothing to read the one the store holds. It replaced Cloud's private `featureOn`, so Cloud and
 * local gate with one rule, one set of typed ids and the same live `flags.changed` refresh. */
export function accountFlagOn(id: FlagId, features?: Readonly<Record<string, boolean>> | null): boolean {
  return decidedOn(features === undefined ? account : features, id);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Told whenever the flags change, for work outside React. Returns a way to stop being told. */
export const onFlagsChange = subscribe;

// a new object on every change of either source, so React re-renders on either
type Sources = { current: Readonly<Record<string, boolean>> | null; account: Readonly<Record<string, boolean>> | null };
let both: Sources = { current: null, account: null };
const snapshot = () => {
  if (both.current !== current || both.account !== account) both = { current, account };
  return both;
};

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
