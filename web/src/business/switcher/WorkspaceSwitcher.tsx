// The WorkspaceSwitcher (ADR-0453 D9, BZ-0453-17, S7 state matrix). Built on BZ-1's workspace
// store (`useWorkspaces`, `workspace.ts`): the list, the remembered per-tab choice and the guards
// (offline, zone lease, personal music playing) all live there; this file draws them.
//
// Marks beside each organisation (silent zones, Needs you, Read only, Pilot) come from the
// business list (`client.workspaces()`), best effort: without it the rows simply have no marks.
//
// This device's facts come in through `device`: the personal app has no app-wide player hook,
// so whoever mounts the switcher says whether personal music is playing here and which zone this
// device is the speaker for, if any (see SwitcherDevice).

import { useEffect, useMemo, useState } from 'react';
import type { Api } from '../../cloud/api';
import { Dialog, Menu, Status } from '../../ui/controls';
import { MenuItem } from '../../ui/primitives';
import type { Workspace } from '../apiTypes';
import { businessClient } from '../client';
import { roleWords, SWITCHER_COPY } from '../copy/shell';
import type { WorkspaceSummary } from '../types';
import { useWorkspaces, type PersonalWorkspace } from '../useWorkspaces';
import { BuildingMark } from './WorkspaceBand';
import './switcher.css';

export type SwitcherDevice = {
  /** This device is playing music from the personal workspace. */
  playingPersonal?: boolean;
  /** The zone this device is the speaker for (it holds that zone's lease), or null. */
  leaseZone?: string | null;
  /** Stops the personal music, for the "Stop" answer to the playing-music ask. */
  stopPersonal?: () => void;
};

type Marks = NonNullable<WorkspaceSummary['marks']>;

/** The light marks per workspace id, from the business list. Never throws. */
export function useSwitcherMarks(api: Api, enabled: boolean) {
  const [marks, setMarks] = useState<Record<string, { marks: Marks; role?: string }>>({});
  useEffect(() => {
    if (!enabled) { setMarks({}); return; }
    let live = true;
    businessClient(api).workspaces()
      .then((list) => {
        if (!live || !Array.isArray(list)) return;
        setMarks(Object.fromEntries(list.map((item) => [item.id, { marks: item.marks ?? {}, role: item.role }])));
      })
      .catch(() => { /* marks are a convenience */ });
    return () => { live = false; };
  }, [api, enabled]);
  return marks;
}

/** Which marks this role may see (S7 matrix): silent counts for managers and above, Needs you for
 * owners and admins, Read only and Pilot for everyone. */
export function visibleMarks(role: string | undefined, marks: Marks | undefined): string[] {
  if (!marks) return [];
  const manager = role === 'owner' || role === 'admin' || role === 'venue_manager';
  const out: string[] = [];
  if (manager && marks.silent_zones) out.push(SWITCHER_COPY.silent(marks.silent_zones));
  if ((role === 'owner' || role === 'admin') && marks.needs_you) out.push(SWITCHER_COPY.needsYou);
  if (marks.read_only) out.push(SWITCHER_COPY.readOnly);
  if (marks.pilot) out.push(SWITCHER_COPY.pilot);
  return out;
}

/** The organisation id a workspace opens at (`/b/{org}`): the server may name it, else the
 * workspace id is the organisation id (OrgRecord: workspace_id equals id). */
export function orgIdOf(workspace: Workspace): string {
  return (workspace as Workspace & { org_id?: string }).org_id ?? workspace.id;
}

export function rowWords(workspace: Workspace, role?: string) {
  if (workspace.kind === 'personal') return SWITCHER_COPY.personal;
  return SWITCHER_COPY.orgRow(workspace.name, roleWords(role ?? workspace.role));
}

export function WorkspaceSwitcher({ api, userId, personal, features, device, online, onSwitched, className }: {
  api: Api;
  userId: string | null;
  personal: PersonalWorkspace;
  /** The account's features; `business.workspaces` must be on explicitly. */
  features: Record<string, boolean>;
  device?: SwitcherDevice;
  /** Forces the network state (tests, harness); otherwise the browser's events decide. */
  online?: boolean;
  /** Called after a switch the store allowed, to move the page there. */
  onSwitched: (workspace: Workspace) => void;
  className?: string;
}) {
  const ws = useWorkspaces({ api, userId, personal, features });
  const marks = useSwitcherMarks(api, ws.enabled);
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState<Workspace | null>(null);
  const { setDevice } = ws;
  const playing = Boolean(device?.playingPersonal);
  const lease = device?.leaseZone ?? null;

  useEffect(() => { setDevice({ playingPersonal: playing, holdsZoneLease: Boolean(lease) }); }, [setDevice, playing, lease]);
  useEffect(() => { if (online !== undefined) setDevice({ online }); }, [setDevice, online]);
  const offline = online === false || !ws.store.getState().online;

  const others = useMemo(() => ws.workspaces.filter((item) => item.kind !== 'personal'), [ws.workspaces]);
  if (!ws.enabled) return null;
  // S7 Empty: a person in no organisation sees no switcher.
  if (!ws.loading && !others.length) return null;

  const pick = (target: Workspace) => {
    setMessage('');
    if (target.id === ws.current.id) return;
    const result = ws.switchTo(target.id);
    if (result.ok) { onSwitched(result.workspace); return; }
    if (result.code === 'playing_personal') { setAsking(target); return; }
    if (result.code === 'zone_lease') { setMessage(SWITCHER_COPY.zoneLease(lease)); return; }
    if (result.code === 'offline') { setMessage(SWITCHER_COPY.offline); return; }
    setMessage(result.reason);
  };

  const answer = (stop: boolean) => {
    const target = asking;
    setAsking(null);
    if (!target) return;
    if (stop) device?.stopPersonal?.();
    const result = ws.switchTo(target.id, { confirmed: true });
    if (result.ok) onSwitched(result.workspace);
    else setMessage(result.code === 'zone_lease' ? SWITCHER_COPY.zoneLease(lease) : result.reason);
  };

  const current = ws.current;
  const currentName = current.kind === 'personal' ? SWITCHER_COPY.personal : current.name;
  return (
    <div className={`ws-switcher ${className ?? ''}`} data-workspace-switcher="">
      <Menu className="ws-switcher-menu" label={<span className="ws-switcher-label" aria-label={SWITCHER_COPY.menuLabel(currentName)}>{current.kind !== 'personal' && <BuildingMark />}<span>{currentName}</span></span>}>
        {offline && <p className="ws-switcher-note" role="note">{SWITCHER_COPY.offline}</p>}
        {ws.workspaces.map((item) => {
          const info = marks[item.id];
          const role = info?.role ?? item.role;
          const shown = item.kind === 'personal' ? [] : visibleMarks(role, { ...info?.marks, pilot: info?.marks.pilot ?? Boolean(item.pilot_until) });
          const words = rowWords(item, role);
          const isCurrent = item.id === current.id;
          return (
            <MenuItem key={item.id} className="ws-switcher-item" aria-current={isCurrent ? 'true' : undefined}
              aria-label={[words, ...shown, isCurrent ? SWITCHER_COPY.current : ''].filter(Boolean).join(', ')}
              onClick={() => pick(item)}>
              <span className="ws-switcher-row">
                {item.kind !== 'personal' && <BuildingMark />}
                <span className="ws-switcher-words">{words}</span>
                {isCurrent && <Status kind="ready">{SWITCHER_COPY.current}</Status>}
              </span>
              {shown.length > 0 && <span className="ws-switcher-marks">{shown.map((mark) => (
                <Status key={mark} kind={mark === SWITCHER_COPY.pilot ? 'planned' : mark === SWITCHER_COPY.readOnly ? 'unavailable' : mark === SWITCHER_COPY.needsYou ? 'needs-action' : 'blocked'}>{mark}</Status>
              ))}</span>}
            </MenuItem>
          );
        })}
        {ws.loading && <div className="ws-switcher-skeleton" role="presentation" aria-label={SWITCHER_COPY.loadingRow}><i /><span className="visually-hidden">{SWITCHER_COPY.loadingRow}</span></div>}
      </Menu>
      {(message || ws.error) && <p className="ws-switcher-message" role="status">{message || SWITCHER_COPY.failedList}</p>}
      {asking && (
        <Dialog title={SWITCHER_COPY.playingAskTitle} onClose={() => setAsking(null)} footer={<>
          <button className="primary" onClick={() => answer(false)}>{SWITCHER_COPY.keepPlaying}</button>
          <button onClick={() => answer(true)}>{SWITCHER_COPY.stop}</button>
          <button onClick={() => setAsking(null)}>{SWITCHER_COPY.cancel}</button>
        </>}>
          <p>{SWITCHER_COPY.playingAsk}</p>
        </Dialog>
      )}
    </div>
  );
}
