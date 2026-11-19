import { useId } from 'react';
import { Meter } from '../../ui/Meter';
import { READINESS, SPLITTING_PAUSED, STEMS_COPY, TAB_NOTICE } from './stemsCopy';
import { SplitterOffer } from './StemsCard';
import { stemsPending } from './useStems';
import type { SplitterState, StemsActions, StemsRole, StemsSnapshot, WindowStatus } from './types';

/** The words for one transition's stem window, or null when there is nothing to say. */
export function readinessWords(status: WindowStatus | undefined, splitter?: SplitterState | null): string | null {
  if (!status) return null;
  const stalled = splitter?.state === 'paused';
  switch (status.state) {
    case 'queued': return stalled ? READINESS.paused : READINESS.queued;
    case 'running': return stalled ? READINESS.paused : READINESS.running(status.progress);
    case 'ready': return READINESS.ready;
    case 'failed': return READINESS.failed(status.why);
    case 'skipped': return READINESS.skipped(status.why);
  }
}

/** One quiet line on a transition's stems, for the editor seam row and Listen Up next: waiting,
 * getting ready (in steps of ten percent, so a screen reader hears a few updates, not every
 * tick), ready, failed or skipped. Text only, so nothing moves under reduced motion. Nothing with
 * the flag off, on a controller (the speaker prepares stems) or for a transition with no window.
 * What was really scheduled is said by the seam's "Scheduled here" line, never by this one. */
export function StemReadiness({ enabled, status, splitter, role = 'speaker', className = '' }: {
  enabled: boolean;
  status: WindowStatus | undefined;
  splitter?: SplitterState | null;
  role?: StemsRole;
  className?: string;
}) {
  if (!enabled || role === 'controller') return null;
  const words = readinessWords(status, splitter);
  if (!words || !status) return null;
  const tone = status.state === 'failed' || status.state === 'skipped' ? 'warn' : 'hint';
  return (
    <p className={`${tone} stem-readiness ${className}`.trim()} role="status" data-stem-window={status.state}>
      {words}
    </p>
  );
}

/** Listen: while stems are still being prepared, a note that the work needs this tab open; after
 * the tab was hidden, the same note says the work paused. Nothing when there is no stem work. */
export function StemsTabNotice({ enabled, snapshot }: { enabled: boolean; snapshot: StemsSnapshot | null }) {
  if (!enabled || !snapshot || snapshot.role === 'controller') return null;
  const hidden = snapshot.splitter.state === 'paused' && snapshot.splitter.why === 'hidden';
  if (!hidden && !stemsPending(snapshot)) return null;
  return (
    <p className="hint stems-tab-notice" role="note" data-stems-notice={hidden ? 'hidden' : 'pending'}>
      {hidden ? SPLITTING_PAUSED.hidden : TAB_NOTICE}
    </p>
  );
}

/** The editor, the first time a stem move is chosen on a device without the splitter: the same
 * offer as This device, in place, with Download and Not now. While it downloads, the progress
 * shows here too. Nothing on a controller, with the flag off, or once the splitter is here. */
export function StemsOffer({ enabled, snapshot, actions, onNotNow }: {
  enabled: boolean;
  snapshot: StemsSnapshot | null;
  actions: Pick<StemsActions, 'download'>;
  onNotNow: () => void;
}) {
  const headingId = useId();
  if (!enabled || !snapshot || snapshot.role === 'controller') return null;
  const { splitter } = snapshot;
  if (splitter.state === 'absent') {
    return (
      <div className="stems-offer stack" role="group" aria-labelledby={headingId}>
        <h3 id={headingId}>{STEMS_COPY.title}</h3>
        <SplitterOffer splitter={splitter} metered={snapshot.metered} actions={actions} onNotNow={onNotNow} />
      </div>
    );
  }
  if (splitter.state === 'downloading') {
    return (
      <div className="stems-offer stack">
        <Meter
          label={STEMS_COPY.progressLabel}
          value={splitter.received}
          max={splitter.total > 0 ? splitter.total : 1}
          valueText={STEMS_COPY.progressValue(splitter.received, splitter.total)}
        />
      </div>
    );
  }
  return null;
}
