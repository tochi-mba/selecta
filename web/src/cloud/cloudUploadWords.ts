import { countOf } from '../ui/format';
import type { UploadRow } from './cloudUploadJournal';
import { sizeWords } from './cloudUploadPacing';
import type { UploadSnapshot } from './cloudUploadQueue';

// The upload queue in plain member words (`cloud.move_to_cloud`): "Upload to your cloud
// library", "Play it from your cloud library only", never "Move".

/** The queue's state, for the chip's one line. */
export function uploadWords(state: Omit<UploadSnapshot, 'words'>): string {
  const { counts } = state;
  const waitingSongs = state.total - state.settled;
  const done = `${countOf(counts.uploaded, 'song')} uploaded`;
  const still = waitingSongs > 0 ? ` ${countOf(waitingSongs, 'song')} ${waitingSongs === 1 ? 'waits' : 'wait'}.` : '';
  if (state.phase === 'idle') return '';
  if (state.phase === 'asking' && state.ask) return `You're on mobile data. Uploading needs about ${sizeWords(state.ask.bytes)}.`;
  if (state.phase === 'stopped') {
    if (state.stop === 'quota') return `Your cloud library is full. ${done}.${still}`;
    if (state.stop === 'grant') return `Uploading to your cloud library isn't available on this account right now.${still} Songs already uploaded stay in your cloud library.`;
    return `Confirm the upload statement to carry on.${still}`;
  }
  if (state.phase === 'paused') {
    if (state.waiting === 'battery') return 'Paused: the battery is below 20%. Uploads carry on when this device is charging.';
    if (state.waiting === 'offline') return 'Waiting for a connection. Uploads carry on by themselves.';
    if (state.waiting === 'wifi') return `Waiting for Wi-Fi.${still}`;
    return `Uploads paused.${still}`;
  }
  if (state.phase === 'finished') {
    if (state.cancelled) return `Uploads cancelled. ${done}; the rest stay on this device.`;
    const extra = [
      counts.in_cloud_library && `${counts.in_cloud_library} already in your cloud library`,
      counts.refused && `${counts.refused} not accepted`,
      counts.changed && `${counts.changed} changed on this device since ${counts.changed === 1 ? 'it was' : 'they were'} added`,
      counts.choose_again && `${counts.choose_again} to choose again`,
      counts.permission_again && `${counts.permission_again} to allow again`,
    ].filter(Boolean);
    const lead = `Uploaded ${countOf(counts.uploaded, 'song')} to your cloud library.`;
    const choose = state.choose.length ? ` Choose ${state.choose.length === 1 ? 'this file' : 'these files'} again to upload ${countOf(state.choose.length, 'more song')}.` : '';
    return `${lead}${extra.length ? ` ${extra.join(', ')}.` : ''}${choose}`;
  }
  if (state.waiting === 'server') return `Trying again. ${state.settled} of ${state.total} done.`;
  return `Uploading to your cloud library: ${state.settled} of ${state.total}`;
}

/** One song's line, for View. */
export function outcomeWords(row: Pick<UploadRow, 'outcome' | 'reason' | 'cloudOnly'>): string {
  switch (row.outcome) {
    case 'uploaded': return row.cloudOnly ? 'Uploaded. It plays from your cloud library only.' : 'Uploaded.';
    case 'in_cloud_library': return row.cloudOnly ? 'Already in your cloud library. It plays from there only.' : 'Already in your cloud library.';
    case 'refused': return `Not accepted: ${refusalWords(row.reason)}`;
    case 'changed': return 'Changed on this device since it was added, so nothing was sent.';
    case 'choose_again': return 'Needs choosing again: SelectaDJ could not open this file.';
    case 'permission_again': return 'Needs permission again: allow SelectaDJ to read this file.';
    case 'removed': return 'Removed from SelectaDJ, so it was not uploaded.';
    default: return 'Waiting.';
  }
}

const REFUSALS: Record<string, string> = {
  format: 'uploads don’t take this kind of file.',
  too_large: 'the file is bigger than your plan allows.',
  too_long: 'the song is longer than your plan allows.',
  quota: 'your cloud library is full.',
  song_mismatch: 'this file isn’t the song in your library it was meant for.',
  not_started: 'SelectaDJ couldn’t start this upload.',
};

/** The server's reason for a refusal, in plain words: its own words where it gave some. */
export function refusalWords(reason: string | null): string {
  if (!reason) return 'the cloud library did not take it.';
  return REFUSALS[reason] ?? reason;
}
