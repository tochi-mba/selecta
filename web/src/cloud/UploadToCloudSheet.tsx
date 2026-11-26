import { useEffect, useId, useState } from 'react';
import { PageLink } from '../shell/PageLink';
import { Action, Sheet, Skeleton, Status } from '../ui/controls';
import { countOf } from '../ui/format';
import { bytes } from './api';
import { RightsStatement } from './RightsStatement';
import {
  agreeToRights, previewUploads, readUploadRights, refusalCode, REFUSAL_WORDS,
  type Request, type StartUploads, type UploadCandidate, type UploadPreview, type UploadRights,
} from './uploadConsent';
import './uploadToCloud.css';

// "Upload to your cloud library" (`cloud.move_to_cloud`, plan "two places" 6c, ADR-0489). Shown
// whenever a batch is started: what the batch would do (the dry run), the upload rights statement
// the first time and whenever its wording changes, and what happens to each song once uploaded.
// Nothing is sent until the member presses Upload, and never before the statement is confirmed.

const MANAGE_STORAGE = '/library?show=cloud&sort=largest';

function measuringWords(preview: UploadPreview): string | null {
  const days = preview.measureDays;
  if (days === null || days <= 1) return null;
  const span = preview.measureAtLeast ? `at least ${countOf(days, 'day')}` : countOf(days, 'day');
  return `Your plan measures a set number of songs each day, so measuring these takes ${span}. They play as soon as they are uploaded.`;
}

/** Titles, listed under a count when there are several. */
function SongList({ songs }: { songs: UploadCandidate[] }) {
  if (songs.length === 0) return null;
  return (
    <ul className="upload-sheet-songs">
      {songs.slice(0, 50).map((song) => <li key={song.songId} dir="auto">{song.title}</li>)}
      {songs.length > 50 && <li>{`and ${countOf(songs.length - 50, 'more song')}`}</li>}
    </ul>
  );
}

function PreviewLines({ preview }: { preview: UploadPreview }) {
  const refusedBy = new Map<string, UploadCandidate[]>();
  for (const { song, reason } of preview.refused) refusedBy.set(REFUSAL_WORDS[reason], [...(refusedBy.get(REFUSAL_WORDS[reason]) ?? []), song]);
  const measuring = measuringWords(preview);
  return (
    <section className="upload-sheet-preview" aria-label="What this upload does">
      <p className="upload-sheet-lead">
        {preview.upload.length
          ? `${countOf(preview.upload.length, 'song')} to upload, ${bytes(preview.uploadBytes)}. You have ${bytes(preview.bytesLeft)} left in your cloud library.`
          : 'Nothing here needs uploading now.'}
      </p>
      <ul className="upload-sheet-facts">
        {preview.waiting.length > 0 && (
          <li>
            <Status kind="paused">{`${countOf(preview.waiting.length, 'song')} won’t fit in the space left. They wait until there is room.`}</Status>
            {' '}<PageLink to={MANAGE_STORAGE}>Manage storage</PageLink>
          </li>
        )}
        {preview.inCloud.length > 0 && <li><Status kind="ready">{`${countOf(preview.inCloud.length, 'song is', 'songs are')} already in your cloud library. Nothing is sent for them.`}</Status></li>}
        {preview.unchecked.length > 0 && <li><Status kind="queued">{`${countOf(preview.unchecked.length, 'song needs', 'songs need')} this browser’s permission again. They are checked when their turn comes.`}</Status></li>}
        {preview.long.length > 0 && <li>{`${countOf(preview.long.length, 'song is', 'songs are')} over 30 minutes. They upload and play, but mixes made in your cloud library leave them out.`}</li>}
        {measuring && <li>{measuring}</li>}
      </ul>
      {[...refusedBy].map(([why, songs]) => (
        <details key={why} className="lw-disclosure upload-sheet-refused" open={songs.length <= 3}>
          <summary>{`${countOf(songs.length, 'song')} can’t upload: ${why}`}</summary>
          <p className="hint">They stay on this device and keep working.</p>
          <SongList songs={songs} />
        </details>
      ))}
    </section>
  );
}

export function UploadToCloudSheet({ request, songs, start, onClose, onStarted }: {
  /** Full /api paths, as ConnectMusic's request. */
  request: Request;
  /** The songs on this device to upload, as `candidatesFrom` lists them. */
  songs: UploadCandidate[];
  /** The upload queue's start. */
  start: StartUploads;
  onClose: () => void;
  /** After the queue has started. */
  onStarted?: (count: number) => void;
}) {
  const [rights, setRights] = useState<UploadRights | null>(null);
  const [rightsProblem, setRightsProblem] = useState('');
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [previewProblem, setPreviewProblem] = useState('');
  const [keepHere, setKeepHere] = useState(false);
  const [changed, setChanged] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const choiceName = useId();

  useEffect(() => {
    let live = true;
    setRightsProblem(''); setPreviewProblem('');
    void readUploadRights(request).then((found) => { if (live) setRights(found); }, () => { if (live) setRightsProblem('SelectaDJ could not check the upload statement. Try again.'); });
    void previewUploads(request, songs).then((found) => { if (live) setPreview(found); }, (error: unknown) => {
      if (!live) return;
      setPreviewProblem(refusalCode(error) === 'uploads_restricted' ? 'Uploads are paused for this account.' : 'SelectaDJ could not check these songs. Try again.');
    });
    return () => { live = false; };
  }, [request, songs, attempt]);

  const needsConsent = rights !== null && rights.applies && !rights.accepted;
  const sendable = preview ? [...preview.upload, ...preview.waiting, ...preview.inCloud, ...preview.unchecked] : [];
  const ready = rights !== null && !needsConsent && preview !== null && sendable.length > 0;

  const accept = async () => {
    if (!rights) return;
    // the wording may have changed while the sheet was open: then the new one is shown to read
    const answer = await agreeToRights(request, rights);
    setRights(answer.rights);
    setChanged(answer.changed);
    setAgreed(!answer.changed);
  };
  const go = async () => {
    if (!ready) return;
    // the order the dry run listed them in: what fits first
    await start(sendable, { keepHere });
    onStarted?.(sendable.length);
    onClose();
  };

  const footer = (
    <div className="upload-sheet-actions">
      <button type="button" onClick={onClose}>Not now</button>
      <Action className="primary" run={go} disabled={!ready} working="Starting…" data-autofocus={ready ? true : undefined}>
        {preview && sendable.length ? `Upload ${countOf(sendable.length, 'song')}` : 'Upload'}
      </Action>
    </div>
  );

  return (
    <Sheet title="Upload to your cloud library" onClose={onClose} footer={footer} className="upload-sheet">
      <div className="upload-sheet-body">
        <p className="hint">SelectaDJ copies each song’s file to your cloud library, kept privately for your account. The file on this device stays as it is.</p>
        {previewProblem
          ? <div className="banner" data-tone="danger" role="alert"><p>{previewProblem}</p><button type="button" onClick={() => { setPreview(null); setAttempt((n) => n + 1); }}>Try again</button></div>
          : preview ? <PreviewLines preview={preview} /> : <Skeleton variant="rows" lines={3} label="Checking these songs" />}
        {rightsProblem && <div className="banner" data-tone="danger" role="alert"><p>{rightsProblem}</p><button type="button" onClick={() => { setRights(null); setAttempt((n) => n + 1); }}>Try again</button></div>}
        {needsConsent && <RightsStatement rights={rights} changed={changed} onAgree={accept} />}
        {agreed && rights?.accepted && <p className="hint" role="status">Thank you. You won’t be asked again unless the statement changes.</p>}
        <fieldset className="upload-sheet-choice">
          <legend>Once each song is uploaded</legend>
          <label>
            <input type="radio" name={choiceName} checked={!keepHere} onChange={() => setKeepHere(false)} />
            <span><b>Play these from your cloud library only</b><span className="hint">They leave this device’s list. The files stay where they are, and each song can play from this device again.</span></span>
          </label>
          <label>
            <input type="radio" name={choiceName} checked={keepHere} onChange={() => setKeepHere(true)} />
            <span><b>Keep playing them from this device too</b><span className="hint">They stay on this device’s list as well.</span></span>
          </label>
        </fieldset>
      </div>
    </Sheet>
  );
}
