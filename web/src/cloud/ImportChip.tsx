import { useEffect, useState } from 'react';
import { useFlag } from '../flags';
import { Status } from '../ui/controls';
import { useImportAnnouncer } from './importAnnouncer';
import { allowAndCarryOn, carryOnNow, retryImportNow, useResumeOffer } from './importResume';
import { useImportSession } from './importSession';
import { offerWords, progressWords } from './ImportStatus';

/** The import chip in the local-first shell's banner (ADR-0463 BF-0463-02, flag
 * `cloud.progressive_import`): while an import keeps checking in the background, it says how far
 * it has got from any page, with a way back to the full progress on More > This device. It shows
 * only while an import is running or paused; hiding it lasts until the import's phase changes.
 * The count is not a live region: the shared announcer speaks milestones only, never each file.
 *
 * With `cloud.resilient_import` it also says when sending waits (offline, the service not
 * answering, another tab importing) and offers the one next step for an interrupted import:
 * Allow for a lapsed folder permission, or the way back to choose picked files again. */
export function ImportChip({ onView, workspaceId }: { onView: () => void; workspaceId?: string }) {
  const live = useImportSession(workspaceId);
  useImportAnnouncer();
  const resilient = useFlag('cloud.resilient_import');
  const offer = useResumeOffer(workspaceId ?? '');
  const [hiddenIn, setHiddenIn] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const waitKey = resilient ? `${live.phase}:${live.waiting?.why ?? ''}:${offer?.kind ?? ''}` : live.phase;
  useEffect(() => { setHiddenIn(null); }, [waitKey]);
  // tick the "trying again in" countdown while the service is not answering
  const [, tick] = useState(0);
  const retryAt = resilient && live.waiting?.why === 'server' ? live.waiting.retryAt : null;
  useEffect(() => {
    if (!retryAt) return undefined;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  if (hiddenIn === waitKey) return null;
  const hide = <button type="button" className="quiet" onClick={() => setHiddenIn(waitKey)}>Hide this notice</button>;

  if (resilient && live.phase !== 'running' && offer) {
    return (
      <div className="cloud-import-chip">
        <Status kind="paused">{offerWords(offer)}</Status>
        {refused && <span role="alert">The browser did not allow it.</span>}
        {offer.kind === 'allow'
          ? <button type="button" className="primary" onClick={() => { void allowAndCarryOn(offer).then((ok) => setRefused(!ok)); }}>{`Allow access to ${offer.folder} to carry on`}</button>
          : <button type="button" className="quiet" onClick={onView}>Choose them again</button>}
        {hide}
      </div>
    );
  }
  if (resilient && live.phase === 'failed') {
    return (
      <div className="cloud-import-chip">
        <Status kind="paused">{live.error ?? 'The import stopped part way. Everything already checked is kept.'}</Status>
        <button type="button" className="quiet" onClick={carryOnNow}>Try again</button>
        {hide}
      </div>
    );
  }
  const paused = live.phase === 'paused';
  if (live.phase !== 'running' && !paused) return null;
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : null;
  const words = paused
    ? resilient
      ? 'Import paused: browser storage is full. Everything checked so far is in your library. Free some space and it carries on.'
      : 'Import paused: browser storage is full. Everything checked so far is in your library.'
    : resilient
      ? progressWords(live, seconds)
      : `Checking your music: ${live.registered} of ${live.total ?? '…'} checked.`;
  return (
    <div className="cloud-import-chip">
      <Status kind={paused || (resilient && live.waiting) ? 'paused' : 'working'}>{words}</Status>
      {resilient && live.waiting?.why === 'server' && !live.elsewhere && <button type="button" className="quiet" onClick={retryImportNow}>Try now</button>}
      <button type="button" className="quiet" onClick={onView}>{paused && resilient ? 'Free up space' : 'See import progress'}</button>
      {hide}
    </div>
  );
}
