import type { ReactNode } from 'react';
import { DevicesPanel } from '../devices/DevicesPanel';
import { RoomPanel } from '../rooms/RoomPanel';
import type { MoreDestinationId } from '../shell/manifest';
import { flagOn } from '../flags';
import { SettingsLayout } from './AccountLayout';
import type { AccountProblem } from './accountStates';
import type { Account, Api, Page } from './api';
import { SUSPENDED_NOTICE } from './authConfig';
import { BillingStandingNotice } from './BillingStanding';
import { AccountProblemNote, SuspendedPanel } from './CloudStates';
import { ConnectionBanner } from './ConnectionBanner';
import { OverQuotaBanner } from './OverQuota';
import type { NoticeGroups } from './NoticeStack';

/** Said while a lapsed sign-in renews in the background. */
export const RENEWING_WORDS = 'Renewing your sign-in. Everything on this page is kept.';

/** The account places behind More, one drawing for both shared shells (CloudShell and
 * HostedShell). Kept out of CloudApp.tsx so it stays under the file-length cap. */
export function morePanelFor({ account, api, settingsPanel, billing, uploads, places }: {
  account: Account | null;
  api: Api;
  settingsPanel: ReactNode;
  billing: ReactNode;
  uploads: ReactNode;
  places: Parameters<typeof SettingsLayout>[0]['places'];
}): (id: MoreDestinationId) => ReactNode {
  return (id) => {
    if (!account) return null;
    switch (id) {
      case 'account': return settingsPanel;
      case 'billing': return billing;
      case 'devices': return <SettingsLayout current="devices" places={places}><DevicesPanel api={api} workspaceId={account.workspace.id} titled={false} /></SettingsLayout>;
      case 'rooms': return <RoomPanel api={api} workspaceId={account.workspace.id} locked={account.feature_locks.rooms} votesOn={flagOn('rooms.votes')} displayOn={flagOn('rooms.display')} playHereOn={flagOn('devices')} freshOnly={account.features['rooms.nickname_confirm'] === true} />;
      case 'uploads': return uploads;
      case 'workspace':
      case 'listening_room': return null;
    }
  };
}

/** The hosted frame's account notices, in a shared shell's banner slot (one source for every
 * frame): `all` in the order every frame has drawn them, and `groups`, the same notices by how
 * pressing they are, for the notice stack (cloud.page_layout). The local-first shell draws its own
 * connection banner, which also says when its library is served from this device. */
export function accountNotices({ account, connectionBanner, exact, go, problem, onRetry, onBillingPage, portalBusy, onPortal, renewing, polling }: {
  account: Account | null;
  /** the hosted frame's connection banner (the local-first shell draws its own) */
  connectionBanner: boolean;
  /** cloud.account_states: the suspended page rather than one line */
  exact: boolean;
  go: (page: Page) => void;
  problem: { kind: AccountProblem; message: string } | null;
  onRetry: () => void;
  /** Plan & billing says its own standing, so the shell does not repeat it there */
  onBillingPage: boolean;
  portalBusy: boolean;
  onPortal: () => void;
  renewing: boolean;
  /** live updates fell back to polling on this network, with the connection up */
  polling: boolean;
}): { all: ReactNode; groups: NoticeGroups } {
  if (!account) return { all: account, groups: {} };
  const connection = connectionBanner && <ConnectionBanner />;
  const suspended = account.user.suspended && (exact ? <SuspendedPanel go={go} /> : <div className="cloud-feedback" role="status">{SUSPENDED_NOTICE}</div>);
  const trouble = problem && <AccountProblemNote kind={problem.kind} onRetry={onRetry} />;
  const quota = <OverQuotaBanner account={account} go={go} />;
  const standing = !onBillingPage && <BillingStandingNotice account={account} place="shell" busy={portalBusy} onPortal={onPortal} />;
  const renew = renewing && <p className="cloud-stream-note" role="status">{RENEWING_WORDS}</p>;
  const slow = polling && <p className="cloud-stream-note" role="status">Live updates are paused on this network, so this page checks for changes every few seconds.</p>;
  return {
    all: <>{connection}{suspended}{trouble}{quota}{standing}{renew}{slow}</>,
    groups: { blocking: <>{suspended}{trouble}{quota}</>, playback: connection, info: <>{standing}{renew}{slow}</> },
  };
}
