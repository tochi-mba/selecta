import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Action, Status } from '../../ui/controls';
import { Meter } from '../../ui/Meter';
import { DOWNLOAD_FAILED, SPLITTING_PAUSED, STEMS_COPY } from './stemsCopy';
import { useStems } from './useStems';
import type { SplitterState, StemsActions, StemsSnapshot, StemsStore } from './types';
import { isLicenceHold } from './types';

/** Where "Free up space" takes focus: the Browser storage card (StorageCard.tsx) by default. */
const STORAGE_HEADING = 'this-device-storage';

/** The offer to download the splitter: what it does, its size, the storage it needs and a note on
 * metered data, with Download and Not now. Shared by the This device card and the editor's first
 * stem move (StemsOffer in StemReadiness.tsx). */
export function SplitterOffer({ splitter, metered, actions, onNotNow }: {
  splitter: Extract<SplitterState, { state: 'absent' }>;
  metered: boolean | null;
  actions: Pick<StemsActions, 'download'>;
  onNotNow: () => void;
}) {
  return (
    <>
      <p>{STEMS_COPY.pitch}</p>
      <p className="hint">{STEMS_COPY.why}</p>
      <p>{STEMS_COPY.offerSize(splitter.bytes, splitter.needBytes)}</p>
      {metered !== false && <p className="hint" data-metered={metered ? 'true' : 'unknown'}>{metered ? STEMS_COPY.metered : STEMS_COPY.meteredUnknown}</p>}
      <div className="cloud-actions">
        <Action className="primary" run={() => actions.download()} working={STEMS_COPY.downloading}>{STEMS_COPY.download}</Action>
        <button type="button" onClick={onNotNow}>{STEMS_COPY.notNow}</button>
      </div>
    </>
  );
}

/** The card's body for one splitter state. */
function SplitterBody({ snapshot, actions, freeSpaceTarget, notNow, setNotNow }: {
  snapshot: StemsSnapshot;
  actions: StemsActions;
  freeSpaceTarget: string;
  notNow: boolean;
  setNotNow: (value: boolean) => void;
}): ReactNode {
  const { splitter, metered } = snapshot;
  switch (splitter.state) {
    case 'unsupported':
      return (
        <>
          <p data-stems-state="unsupported"><Status kind="unavailable">{STEMS_COPY.unsupportedTitle(splitter.reason)}</Status></p>
          <p className="hint">{STEMS_COPY.unsupportedAfter}</p>
          {splitter.code === 'crash_guard' && (
            <>
              <p className="hint">{STEMS_COPY.crashRetryHint}</p>
              <div className="cloud-actions">
                <Action run={() => actions.retryAfterCrash()} working={STEMS_COPY.tryingAgain}>{STEMS_COPY.crashRetry}</Action>
              </div>
            </>
          )}
        </>
      );
    case 'absent':
      return (
        <>
          {splitter.updated && <p role="note" data-stems-state="updated">{STEMS_COPY.updated}</p>}
          {splitter.removed && <p role="status" data-stems-state="removed">{STEMS_COPY.removed(splitter.freedBytes)}</p>}
          {notNow ? (
            <>
              <p>{STEMS_COPY.notNowShort}</p>
              <div className="cloud-actions">
                <Action run={() => { setNotNow(false); return actions.download(); }} working={STEMS_COPY.downloading}>{STEMS_COPY.download}</Action>
              </div>
            </>
          ) : (
            <SplitterOffer splitter={splitter} metered={metered} actions={actions} onNotNow={() => setNotNow(true)} />
          )}
        </>
      );
    case 'downloading':
      return (
        <>
          {splitter.updated && <p role="note">{STEMS_COPY.updated}</p>}
          <Meter
            label={STEMS_COPY.progressLabel}
            value={splitter.received}
            max={splitter.total > 0 ? splitter.total : 1}
            valueText={STEMS_COPY.progressValue(splitter.received, splitter.total)}
          />
          <p className="hint" role="status" data-stems-state={splitter.paused ? 'download-paused' : 'downloading'}>
            {splitter.paused ? STEMS_COPY.downloadPausedLine : STEMS_COPY.downloadingLine}
          </p>
          <div className="cloud-actions">
            {splitter.paused
              ? <Action run={() => actions.resume()}>{STEMS_COPY.resume}</Action>
              : <Action run={() => actions.pause()}>{STEMS_COPY.pause}</Action>}
            <Action className="cloud-quiet" run={() => actions.cancel()}>{STEMS_COPY.cancel}</Action>
          </div>
        </>
      );
    case 'failed':
      return (
        <>
          <div role="alert" data-stems-state={`failed-${splitter.why}`}>
            <p><Status kind="failed" /> {DOWNLOAD_FAILED[splitter.why](splitter.detail)}</p>
          </div>
          <div className="cloud-actions">
            <Action run={() => actions.download()} working={STEMS_COPY.tryingAgain}>{STEMS_COPY.tryAgain}</Action>
            {splitter.why === 'storage_full' && (
              <button type="button" onClick={() => focusTarget(freeSpaceTarget)}>{STEMS_COPY.freeSpace}</button>
            )}
          </div>
        </>
      );
    case 'paused':
      return (
        <p data-stems-state={`paused-${splitter.why}`}><Status kind="paused" /> {SPLITTING_PAUSED[splitter.why]}</p>
      );
    case 'ready':
      return (
        <>
          {splitter.updated && <p role="note" data-stems-state="updated">{STEMS_COPY.updated}</p>}
          <p data-stems-state="ready"><Status kind="ready">{STEMS_COPY.readyStatus}</Status> {STEMS_COPY.readyLine(splitter.bytes)}</p>
          <p className="hint">{STEMS_COPY.implementation(splitter.implementation)}</p>
          <RemoveSplitter remove={() => actions.remove()} />
        </>
      );
  }
}

/** Remove, asked twice: the first press says what removing does, with Keep it focused. */
function RemoveSplitter({ remove }: { remove: () => unknown }) {
  const [confirming, setConfirming] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useLayoutEffect(() => {
    if (!moved.current) return;
    (confirming ? keep : opener).current?.focus();
  }, [confirming]);
  const set = (value: boolean) => {
    moved.current = true;
    setConfirming(value);
  };
  return confirming ? (
    <div className="stems-confirm" role="group" aria-label={STEMS_COPY.remove}>
      <p className="hint">{STEMS_COPY.removeHint}</p>
      <div className="cloud-actions">
        <button type="button" ref={keep} onClick={() => set(false)}>{STEMS_COPY.keep}</button>
        <Action className="cloud-danger-action" run={remove} working={STEMS_COPY.removing}>{STEMS_COPY.remove}</Action>
      </div>
    </div>
  ) : (
    <div className="cloud-actions">
      <button type="button" ref={opener} className="cloud-quiet" onClick={() => set(true)}>{`${STEMS_COPY.remove}…`}</button>
    </div>
  );
}

/** Moves focus to the heading (or any element) with this id, making it focusable if it is not. */
function focusTarget(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute('tabindex', '-1');
  target.scrollIntoView?.({ block: 'start' });
  target.focus();
}

/** More > This device: the stem splitter. Presentational: it renders the snapshot it is given and
 * calls the actions. Nothing at all with the flag off (`enabled` false) or no snapshot, so the
 * page closes up around it. A controller device never offers the download. */
export function StemsCardView({ enabled, snapshot, actions, freeSpaceTarget = STORAGE_HEADING }: {
  enabled: boolean;
  snapshot: StemsSnapshot | null;
  actions: StemsActions;
  /** the id of what "Free up space" focuses; StorageCard's heading by default */
  freeSpaceTarget?: string;
}) {
  const [notNow, setNotNow] = useState(false);
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusWasInside = useRef(false);
  const stateKey = snapshot ? `${snapshot.role}:${snapshot.splitter.state}` : '';
  // A pressed button often goes away with the state it belonged to (Download becomes the progress
  // bar). Focus then goes to the card's heading, never to the top of the page.
  useLayoutEffect(() => {
    const at = document.activeElement;
    if (focusWasInside.current && (!at || at === document.body || !section.current?.contains(at))) heading.current?.focus({ preventScroll: true });
  }, [stateKey]);
  // a model whose licence isn't cleared is not offered at all, on any device (ADR-0459): nothing to explain
  if (!enabled || !snapshot || isLicenceHold(snapshot.splitter)) return null;
  const controller = snapshot.role === 'controller';
  return (
    <section
      ref={section}
      className="panel stack stems-card"
      aria-labelledby="this-device-stems"
      data-stems-role={snapshot.role}
      onFocus={() => { focusWasInside.current = true; }}
      onBlur={(event) => { if (event.relatedTarget && !section.current?.contains(event.relatedTarget as Node)) focusWasInside.current = false; }}
    >
      <h2 id="this-device-stems" ref={heading} tabIndex={-1}>{STEMS_COPY.title}</h2>
      {controller
        ? <p data-stems-state="controller">{STEMS_COPY.controller}</p>
        : <SplitterBody snapshot={snapshot} actions={actions} freeSpaceTarget={freeSpaceTarget} notNow={notNow} setNotNow={setNotNow} />}
    </section>
  );
}

/** The card reading a live store. Mount it in More > This device. */
export function StemsCard({ enabled, store, freeSpaceTarget }: { enabled: boolean; store: StemsStore | null; freeSpaceTarget?: string }) {
  const snapshot = useStems(enabled ? store : null);
  if (!enabled || !store) return null;
  return <StemsCardView enabled={enabled} snapshot={snapshot} actions={store.actions} freeSpaceTarget={freeSpaceTarget} />;
}
