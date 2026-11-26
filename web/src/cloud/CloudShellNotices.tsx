import { useState, type ReactNode } from 'react';
import type { FlagId } from '../flags';
import { navigate } from '../router';
import { ChangedFromLine } from '../devices/ChangedFromLine';
import { ControllerNotices } from '../devices/ControllerNotices';
import { OtherTabLine } from '../devices/OtherTabLine';
import { PlayNoticeLine } from '../devices/PlayNoticeLine';
import type { useWhereToPlay } from '../devices/useWhereToPlay';
import type { Account } from './api';
import { ConnectionBanner } from './ConnectionBanner';
import { isHostedAccount } from './deviceMusicGate';
import type { useLocalFirstPlayer } from './deviceMusicPlayer';
import { ImportChip } from './ImportChip';
import { CutoverNotice } from './migration/CutoverNotice';

/** Everything CloudShell shows above the page: playback lines, the connection, the account's own
 * notices, import progress, the cutover note and page feedback. Kept out of CloudShell.tsx so the
 * shell stays under the file-length cap. */
export function CloudShellNotices({ account, workspaceId, on, playback, deviceName, asked, accountMix, where, playNoticeShown, onPlayHere, offlineShell, servedFrom, offlineReadOnly, notices, feedback }: {
  account: Account;
  workspaceId: string;
  on: (id: FlagId) => boolean;
  playback: ReturnType<typeof useLocalFirstPlayer>['device'];
  /** a device's name from its id, for "changed from" */
  deviceName: (id: string) => string | null;
  /** another device asked this one to play: the press that allows sound here */
  asked: ReactNode;
  accountMix: ReactNode;
  where: ReturnType<typeof useWhereToPlay>;
  /** false where the page itself says where the music plays (Listen as a remote) */
  playNoticeShown: boolean;
  onPlayHere: () => void;
  offlineShell: boolean;
  servedFrom: { at: number | null } | null;
  offlineReadOnly: boolean;
  /** the account's notices from CloudApp (suspended, problem, over quota, paused live updates) */
  notices?: ReactNode;
  feedback?: ReactNode;
}) {
  // cloud.offline_playback: said once when playing offline ended because another device took over
  const [takeoverSeen, setTakeoverSeen] = useState('');
  return <>{playback.view?.speaker === 'here' && <ChangedFromLine change={playback.changedFrom} nameOf={deviceName} />}{asked}{accountMix}{where.picker}{where.notice && playNoticeShown && <PlayNoticeLine notice={where.notice} onDismiss={where.clearNotice} />}{(playback.otherTab || playback.carryOn) && <OtherTabLine gone={playback.carryOn} onPlayHere={onPlayHere} />}{offlineShell && <ConnectionBanner plays={on('cloud.offline_playback')} cachedAt={servedFrom ? servedFrom.at : undefined} signedOutOffline={offlineReadOnly} />}{notices}{on('cloud.offline_playback') && playback.offlineNotice && playback.offlineNotice !== takeoverSeen && <p className="warn" role="alert">{playback.offlineNotice} <button onClick={() => setTakeoverSeen(playback.offlineNotice)}>Dismiss</button></p>}{on('devices.remote_control') && playback.view?.speaker !== 'here' && <ControllerNotices notices={playback.view?.notices} speakerName={playback.view?.speaker_name ?? null} session={playback.view?.session ?? null} send={(name, args) => { void playback.command(name, args); }} />}{on('cloud.progressive_import') && <ImportChip workspaceId={workspaceId} onView={() => navigate('/workshop')} />}{isHostedAccount(account) && <CutoverNotice accountId={account.user.id} storedBytes={account.entitlement.storage_used_bytes} />}{feedback}</>;
}
