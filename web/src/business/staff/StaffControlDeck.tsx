// StaffControlDeck (ADR-0453 D10): the BigActions a bartender uses with one wet thumb. Bigger,
// Calmer, Something else, Skip, Pause or Resume, the volume up to the venue's cap, Requests with
// a count, and Stay open late when the venue has an allowance. Nothing destructive lives here.
// While the zone's state is unknown the deck is a skeleton with no buttons at all.

import { STAFF_COPY, STEER_LABEL, requestsLabel, type SteerWord } from '../copy/staff';
import { BigAction } from './BigAction';
import { VolumeLimitSlider } from './VolumeLimitSlider';
import './staff.css';

const STEERS: SteerWord[] = ['bigger', 'calmer', 'something_else'];

export type StayLate = { kind: 'offer'; words: string; run: () => Promise<unknown>; disabled?: string | null } | { kind: 'on'; words: string };

export function DeckSkeleton() {
  return (
    <div className="biz-deck-skeleton" aria-busy="true" aria-label={STAFF_COPY.loading} data-testid="deck-skeleton">
      {Array.from({ length: 6 }, (_, index) => <i key={index} />)}
    </div>
  );
}

export function StaffControlDeck({ zoneName, paused, steerable, onSteer, onSkip, onPause, onResume, volume, cap, onVolume, requests, onRequests, stayLate }: {
  zoneName: string;
  paused: boolean;
  /** false for a zone that is not playing (silent, or not playing today): steering has nothing to change. */
  steerable: boolean;
  onSteer: (word: SteerWord) => Promise<unknown>;
  onSkip: () => Promise<unknown>;
  onPause: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  volume: number;
  cap: number;
  onVolume: (level: number) => void;
  requests: number;
  onRequests: () => void;
  stayLate?: StayLate | null;
}) {
  return (
    <section className="biz-deck" aria-label={`${STAFF_COPY.deckLabel}, ${zoneName}`} data-testid="staff-deck">
      {steerable && STEERS.map((word) => (
        <BigAction key={word} run={() => onSteer(word)}>{STEER_LABEL[word]}</BigAction>
      ))}
      {steerable && <BigAction run={onSkip}>{STAFF_COPY.skip}</BigAction>}
      {paused
        ? <BigAction run={onResume}>{STAFF_COPY.resume}</BigAction>
        : <BigAction run={onPause} disabled={steerable ? null : undefined}>{STAFF_COPY.pause}</BigAction>}
      <BigAction run={onRequests} aria-label={`${requestsLabel(requests)} waiting`} detail={`${requests} waiting`}>{STAFF_COPY.requests}</BigAction>
      {stayLate?.kind === 'offer' && <BigAction className="biz-deck-wide" run={stayLate.run} disabled={stayLate.disabled}>{stayLate.words}</BigAction>}
      {stayLate?.kind === 'on' && <p className="biz-staff-line biz-deck-wide">{stayLate.words}</p>}
      <VolumeLimitSlider label={STAFF_COPY.volume} value={volume} cap={cap} onChange={onVolume} />
    </section>
  );
}
