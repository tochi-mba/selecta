import type { PlayNotice } from './useWhereToPlay';

// ADR-0475: one state, one message, in one place. Where the music is going, in one calm sentence
// with its choices inline; the latest replaces any earlier one. Never a toast, never over the
// play controls: it sits in the Listen card's status line (or the page's banner elsewhere).
export function PlayNoticeLine({ notice, onDismiss }: { notice: PlayNotice; onDismiss: () => void }) {
  return (
    <div className="play-notice" role="status" data-testid="play-notice">
      <p>{notice.text}</p>
      <span className="play-notice-actions">
        {notice.actions.map((action) => <button key={action.label} type="button" onClick={action.run}>{action.label}</button>)}
        <button type="button" className="quiet" onClick={onDismiss}>Dismiss</button>
      </span>
    </div>
  );
}
