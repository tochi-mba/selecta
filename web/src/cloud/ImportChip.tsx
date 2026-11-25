import { useEffect, useState, useSyncExternalStore } from 'react';
import { NumberRoll } from '../feel/numberRoll';
import { feelOn, onFeelChange } from '../feel/root';
import { useFlag } from '../flags';
import { Icon } from '../ui/Icon';
import { Meter } from '../ui/Meter';
import { IconButton } from '../ui/primitives';
import { useImportAnnouncer } from './importAnnouncer';
import { allowAndCarryOn, carryOnNow, retryImportNow, useResumeOffer } from './importResume';
import { useImportSession } from './importSession';
import { checkedOf, checkedWords, formatCount, offerWords, progressWords } from './ImportStatus';
import './libraryWorkspace.css';

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
  const moving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
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
  const hide = <IconButton icon="close" label="Hide this notice" className="lw-chip-hide" onClick={() => setHiddenIn(waitKey)} />;

  if (resilient && live.phase !== 'running' && offer) {
    return (
      <div className="cloud-import-chip banner" data-tone="warn">
        <Icon name="pause" size="toolbar" />
        <p>{offerWords(offer)}{refused && <span role="alert"> The browser did not allow it.</span>}</p>
        {offer.kind === 'allow'
          ? <button type="button" className="primary" onClick={() => { void allowAndCarryOn(offer).then((ok) => setRefused(!ok)); }}>{`Allow ${offer.folder}`}</button>
          : <button type="button" onClick={onView}>Choose them again</button>}
        {hide}
      </div>
    );
  }
  if (resilient && live.phase === 'failed') {
    return (
      <div className="cloud-import-chip banner" data-tone="warn">
        <Icon name="warning" size="toolbar" />
        <p>{live.error ?? 'Adding your music stopped part way. Songs already added are kept.'}</p>
        <button type="button" onClick={carryOnNow}>Try again</button>
        {hide}
      </div>
    );
  }
  const paused = live.phase === 'paused';
  if (live.phase !== 'running' && !paused) return null;
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : null;
  const waiting = paused || (resilient && !!live.waiting);
  const words = paused
    ? resilient
      ? 'Paused: browser storage is full. Songs added so far are in your library. Free some space and it carries on.'
      : 'Paused: browser storage is full. Songs added so far are in your library.'
    : resilient && (live.waiting || live.elsewhere)
      ? progressWords(live, seconds)
      : null;
  const checked = checkedOf(live);
  return (
    <div className="cloud-import-chip banner" data-tone={waiting ? 'warn' : 'info'}>
      <Icon name={waiting ? 'pause' : 'music'} size="toolbar" />
      {words
        ? <p>{words}</p>
        : (
          <div className="lw-chip-progress">
            {/* an import that resumed after a reload or a closed tab says so (plan "Nothing is lost") */}
            <p><b>{resilient && (live.resumed ?? 0) > 0 ? 'Carrying on your import' : 'Adding your music'}</b> {moving
              // ADR-0477: the count rolls up as files are checked; the words read the same
              ? <span><NumberRoll value={checked} format={formatCount} />{typeof live.total === 'number' ? ` of ${formatCount(live.total)} checked` : ' checked'}</span>
              : <span>{checkedWords(live)}</span>}</p>
            <Meter label="Files checked" showLabel={false} value={typeof live.total === 'number' ? checked : undefined} max={Math.max(live.total ?? 1, 1)} valueText={checkedWords(live)} />
          </div>
        )}
      {resilient && live.waiting?.why === 'server' && !live.elsewhere && <button type="button" onClick={retryImportNow}>Try now</button>}
      <button type="button" className="quiet" onClick={onView}>{paused && resilient ? 'Free up space' : 'See progress'}</button>
      {hide}
    </div>
  );
}
