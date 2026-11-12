import { useId, useState } from 'react';
import { isSettled, PlanGroup } from '../lucy/reducer';
import type { Card, Permission, Progress } from '../lucy/types';
import { CARD_WORDS, durationWords, humanize, plural, valueWords } from '../lucy/words';
import { Action, Status } from '../ui/controls';
import { CardVisual } from './LucyVisuals';

/** What Lucy did on the way to an answer, one card per step. A card says its state in words as well
 * as with its mark, and stops moving once it's settled. Only a running step with no count to show
 * gets a quiet moving cue, and not even that when motion is turned down. */

const titleOf = (card: Card) => card.title || humanize(card.op) || 'A step';

function countWords(card: Card): string {
  const total = typeof card.count === 'number' ? card.count : null;
  const shown = typeof card.returned === 'number' ? card.returned : null;
  if (total !== null && shown !== null && shown < total) return `Showing ${shown} of ${total}${card.capped ? ', the list was cut short' : ''}`;
  if (total !== null) return `${plural(total, 'result')}${card.capped ? ', the list was cut short' : ''}`;
  if (shown !== null) return `Showing ${shown}${card.capped ? ', the list was cut short' : ''}`;
  return '';
}

function progressWords(progress: Progress): string {
  const unit = progress.unit ? ` ${progress.unit}` : '';
  return typeof progress.total === 'number' ? `${progress.done} of ${progress.total}${unit}` : `${progress.done}${unit} so far`;
}

function ProgressLine({ progress }: { progress: Progress }) {
  const total = typeof progress.total === 'number' && progress.total > 0 ? progress.total : null;
  return (
    <div className="lucy-progress-line">
      {total !== null && (
        <span className="lucy-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, (progress.done / total) * 100))}%` }} /></span>
      )}
      <span className="hint">{progressWords(progress)}</span>
    </div>
  );
}

function statusLabel(card: Card): string {
  const words = CARD_WORDS[card.status]?.words ?? humanize(card.status);
  return card.status === 'retrying' || (card.attempt > 1 && !isSettled(card.status)) ? `${words} (attempt ${card.attempt})` : words;
}

export function ActivityCard({ card, still }: { card: Card; still: boolean }) {
  const kind = CARD_WORDS[card.status]?.kind ?? 'planned';
  const settled = isSettled(card.status);
  const counted = countWords(card);
  const notices = Array.isArray(card.notices) ? card.notices : [];
  const hasDetails = notices.length > 0 || !!card.error || !!card.skipped_because || card.attempt > 1 || typeof card.duration_ms === 'number' || !!card.note || !!card.op;
  return (
    <article className={`lucy-card is-${card.status}`} aria-label={`${titleOf(card)}: ${statusLabel(card)}`}>
      <header className="lucy-card-head">
        <h4 dir="auto">{titleOf(card)}</h4>
        <Status kind={kind}>{statusLabel(card)}</Status>
      </header>
      {!settled && card.progress && <ProgressLine progress={card.progress} />}
      {!settled && !card.progress && !still && <span className="lucy-indeterminate" aria-hidden="true"><i /></span>}
      {counted && <p className="lucy-card-count">{counted}</p>}
      {card.status === 'failed' && card.error && <p className="warn">{card.error}</p>}
      {card.status === 'skipped' && card.skipped_because && <p className="hint">Skipped because {card.skipped_because}</p>}
      <CardVisual card={card} />
      {hasDetails && (
        <details className="lucy-card-details">
          <summary>Details</summary>
          <dl className="lucy-facts">
            {card.note && <div><dt>Note</dt><dd dir="auto">{card.note}</dd></div>}
            {card.op && <div><dt>Step</dt><dd>{humanize(card.op)}</dd></div>}
            {card.attempt > 0 && <div><dt>Attempt</dt><dd>{card.attempt}</dd></div>}
            {typeof card.duration_ms === 'number' && <div><dt>Took</dt><dd>{durationWords(card.duration_ms)}</dd></div>}
            {card.skipped_because && <div><dt>Skipped because</dt><dd>{card.skipped_because}</dd></div>}
            {card.error && <div><dt>What went wrong</dt><dd>{card.error}</dd></div>}
          </dl>
          {notices.length > 0 && <ul className="lucy-warnings">{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul>}
        </details>
      )}
    </article>
  );
}

/** The few steps worth seeing without opening the plan: what's going on now, what went wrong, and
 * the last thing finished. A short plan shows every step. */
function milestones(cards: Card[]): Card[] {
  if (cards.length <= 4) return cards;
  const live = cards.filter((card) => !isSettled(card.status));
  const failed = cards.filter((card) => card.status === 'failed');
  const done = cards.filter((card) => card.status === 'completed').slice(-1);
  const picked = new Set([...failed, ...live.slice(0, 2), ...done]);
  return cards.filter((card) => picked.has(card));
}

export function PlanGroupView({ group, cards, still }: { group: PlanGroup; cards: Card[]; still: boolean }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  if (!cards.length) return null;
  const done = cards.filter((card) => card.status === 'completed').length;
  const failed = cards.filter((card) => card.status === 'failed').length;
  const working = cards.find((card) => card.status === 'running' || card.status === 'progress' || card.status === 'retrying');
  const settled = group.done || cards.every((card) => isSettled(card.status));
  const summary = settled
    ? `${done} of ${plural(cards.length, 'step')} done${failed ? `, ${failed} didn’t work` : ''}${group.duration_ms ? ` · took ${durationWords(group.duration_ms)}` : ''}`
    : working ? `Working on: ${titleOf(working)} (${done} of ${cards.length} done)` : `${done} of ${plural(cards.length, 'step')} done`;
  const short = milestones(cards);
  return (
    <section className={`lucy-plan ${settled ? 'is-settled' : 'is-live'}`} aria-label="Lucy’s steps">
      <div className="lucy-plan-head">
        <p className="lucy-plan-summary">{summary}</p>
        <button type="button" className="quiet" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show all ${plural(cards.length, 'step')}`}
        </button>
      </div>
      <div id={regionId}>
        {open
          ? <div className="lucy-cards">{cards.map((card) => <ActivityCard key={`${card.plan}/${card.step}`} card={card} still={still} />)}</div>
          : (
            <ol className="lucy-milestones">
              {short.map((card) => (
                <li key={`${card.plan}/${card.step}`}>
                  <Status kind={CARD_WORDS[card.status]?.kind ?? 'planned'}>{statusLabel(card)}</Status>
                  <span dir="auto">{titleOf(card)}</span>
                  {countWords(card) && <span className="soft"> · {countWords(card)}</span>}
                </li>
              ))}
              {short.length < cards.length && <li className="soft">and {plural(cards.length - short.length, 'more step')}</li>}
            </ol>
          )}
      </div>
    </section>
  );
}

const TIER_WORDS: Record<Permission['tier'], string> = {
  compute: 'Lucy wants to use your computer for this',
  save: 'Lucy wants to save something',
  play: 'Lucy wants to change what’s playing',
};

/** Lucy asking before it does something. The exact operation and what it would act on are spelled
 * out, and nothing happens until someone answers. */
export function PermissionCard({ permission, onDecide }: { permission: Permission; onDecide: (id: string, decision: 'allow' | 'deny') => Promise<void> }) {
  const args = Object.entries(permission.arguments ?? {}).filter(([, value]) => value !== undefined);
  const headingId = useId();
  return (
    <article className={`lucy-permission is-${permission.status}`} aria-labelledby={headingId}>
      <h4 id={headingId}>{TIER_WORDS[permission.tier] ?? 'Lucy is asking first'}</h4>
      <p dir="auto">{permission.text || `${humanize(permission.operation)}?`}</p>
      {args.length > 0 && (
        <dl className="lucy-facts">
          {args.map(([name, value]) => <div key={name}><dt>{humanize(name)}</dt><dd dir="auto">{valueWords(value)}</dd></div>)}
        </dl>
      )}
      {permission.status === 'pending' ? (
        <div className="row wrap">
          <Action className="primary" working="Allowing…" run={() => onDecide(permission.id, 'allow')}>Allow</Action>
          <Action working="Saying no…" run={() => onDecide(permission.id, 'deny')}>Not now</Action>
        </div>
      ) : (
        <p className="hint">{permission.status === 'allowed' ? <Status kind="ready">You allowed this</Status> : <Status kind="unavailable">You said not now</Status>}</p>
      )}
    </article>
  );
}
