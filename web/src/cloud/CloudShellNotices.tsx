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
import { NoticeStack, type NoticeGroups } from './NoticeStack';
import { UploadChip } from './UploadChip';

type Playback = ReturnType<typeof useLocalFirstPlayer>['device'];

/** ADR-0475 F: another tab of this browser makes the sound; null when none does. With
 * cloud.page_layout it shows only on Listen and in the mini player. */
export function otherTabNote(playback: Playback, onPlayHere: () => void): ReactNode {
  return (playback.otherTab || playback.carryOn) ? <OtherTabLine gone={playback.carryOn} onPlayHere={onPlayHere} /> : null;
}

/** Everything CloudShell shows above the page: playback lines, the connection, the account's own
 * notices, import progress, the cutover note and page feedback. Kept out of CloudShell.tsx so the
 * shell stays under the file-length cap. With cloud.page_layout on they are one stack, most
 * pressing first, with one open at a time (NoticeStack.tsx). */
export function CloudShellNotices({ account, workspaceId, on, playback, deviceName, asked, accountMix, where, playNoticeShown, onPlayHere, onListen, offlineShell, servedFrom, offlineReadOnly, notices, accountNotices, feedback, deviceMusic = true }: {
  account: Account;
  /** cloud.one_shell: false with no music on this account's devices, so nothing about a device's
   * music is said here: no import chip, no upload-from-this-device chip, no note about the change */
  deviceMusic?: boolean;
  workspaceId: string;
  on: (id: FlagId) => boolean;
  playback: Playback;
  /** a device's name from its id, for "changed from" */
  deviceName: (id: string) => string | null;
  /** another device asked this one to play: the press that allows sound here */
  asked: ReactNode;
  accountMix: ReactNode;
  where: ReturnType<typeof useWhereToPlay>;
  /** false where the page itself says where the music plays (Listen as a remote) */
  playNoticeShown: boolean;
  onPlayHere: () => void;
  /** the page is Listen, which keeps the other-tab line in the stack */
  onListen: boolean;
  offlineShell: boolean;
  servedFrom: { at: number | null } | null;
  offlineReadOnly: boolean;
  /** the account's notices from CloudApp (suspended, problem, over quota, paused live updates) */
  notices?: ReactNode;
  /** cloud.page_layout: the same account notices, by how pressing they are */
  accountNotices?: NoticeGroups;
  feedback?: ReactNode;
}) {
  // cloud.offline_playback: said once when playing offline ended because another device took over
  const [takeoverSeen, setTakeoverSeen] = useState('');
  const changedFrom = playback.view?.speaker === 'here' && <ChangedFromLine change={playback.changedFrom} nameOf={deviceName} />;
  const playNotice = where.notice && playNoticeShown && <PlayNoticeLine notice={where.notice} onDismiss={where.clearNotice} />;
  const connection = offlineShell && <ConnectionBanner plays={on('cloud.offline_playback')} cachedAt={servedFrom ? servedFrom.at : undefined} signedOutOffline={offlineReadOnly} />;
  const takeover = on('cloud.offline_playback') && playback.offlineNotice && playback.offlineNotice !== takeoverSeen && <p className="warn" role="alert">{playback.offlineNotice} <button onClick={() => setTakeoverSeen(playback.offlineNotice)}>Dismiss</button></p>;
  const controller = on('devices.remote_control') && playback.view?.speaker !== 'here' && <ControllerNotices notices={playback.view?.notices} speakerName={playback.view?.speaker_name ?? null} session={playback.view?.session ?? null} send={(name, args) => { void playback.command(name, args); }} />;
  const importing = deviceMusic && on('cloud.progressive_import') && <ImportChip workspaceId={workspaceId} onView={() => navigate('/workshop')} />;
  // cloud.move_to_cloud: the upload queue's chip sits beside the import chip
  const uploading = deviceMusic && on('cloud.move_to_cloud') && <UploadChip workspaceId={workspaceId} />;
  const layout = on('cloud.page_layout');
  const cutover = deviceMusic && isHostedAccount(account) && <CutoverNotice accountId={account.user.id} storedBytes={account.entitlement.storage_used_bytes} line={layout} />;
  if (!layout) return <>{changedFrom}{asked}{accountMix}{where.picker}{playNotice}{otherTabNote(playback, onPlayHere)}{connection}{notices}{takeover}{controller}{importing}{uploading}{cutover}{feedback}</>;
  // the picker answers a press of Play, so it is never folded away
  return (
    <>
      {where.picker}
      <NoticeStack
        blocking={accountNotices?.blocking}
        playback={<>{asked}{changedFrom}{accountMix}{playNotice}{onListen && otherTabNote(playback, onPlayHere)}{connection}{accountNotices?.playback}{takeover}{controller}</>}
        progress={<>{importing}{uploading}{accountNotices?.progress}</>}
        info={<>{cutover}{accountNotices?.info}{feedback}</>}
      />
    </>
  );
}
