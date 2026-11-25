import { useState } from 'react';
import { buildMark } from '../support';
import { answerOf, LABELS, levelWords, playedWords, REASONS, resultsJson, resultsText, tally, VERDICTS, type Session } from './session';

/** The reveal (tools.listening_room): only here is it said which of A and B was which, what each
 * really played, and how the votes fell. The results copy as text or download as versioned JSON. */
export function RevealScreen({ session, onBack, onNew }: { session: Session; onBack(): void; onNew(): void }) {
  const [said, setSaid] = useState('');
  const counted = tally(session);
  const variants = session.trials[0]?.variants ?? [];
  const build = buildMark();
  const name = (id: string) => variants.find((variant) => variant.id === id)?.name ?? id;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(resultsText(session, { build }));
      setSaid('Results copied.');
    } catch {
      setSaid('This browser would not copy. Download the file instead.');
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(resultsJson(session, { build }), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `selectadj-listening-room-${session.id}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setSaid('Results downloaded.');
  };

  return (
    <section className="lr-reveal" aria-labelledby="lr-reveal-title">
      <h2 id="lr-reveal-title" className="lr-start-title">What you heard</h2>
      <p className="lr-lead">
        {variants.map((variant) => `${variant.name} won ${counted.wins[variant.id] ?? 0}`).join(', ')}.
        {' '}No difference {counted.same}, both bad {counted.bothBad}, can’t judge {counted.cantJudge}{counted.open ? `, unanswered ${counted.open}` : ''}.
      </p>
      <dl className="lr-facts lr-tally">
        {variants.map((variant) => <div key={variant.id}><dt>{variant.name} won</dt><dd>{counted.wins[variant.id] ?? 0}</dd></div>)}
        <div><dt>No difference</dt><dd>{counted.same}</dd></div>
        <div><dt>Both bad</dt><dd>{counted.bothBad}</dd></div>
        <div><dt>Can’t judge</dt><dd>{counted.cantJudge}</dd></div>
      </dl>
      <p className="lr-hint">Before is the browser player as it was: each transition planned 45 seconds from the end, every song at its own level. After plans each transition as its song starts, plays every song at one level and waits for slow analysis.</p>

      <ol className="lr-results">
        {session.trials.map((trial) => {
          const answer = answerOf(session, trial.id);
          return (
            <li key={trial.id} className="lr-result">
              <h3 className="lr-small-title">{trial.from.title} <span className="lr-into">into</span> {trial.to.title}</h3>
              <p>
                <b>{VERDICTS.find((verdict) => verdict.id === answer.verdict)?.words ?? 'No answer'}</b>
                {answer.reasons.length > 0 && `: ${answer.reasons.map((reason) => REASONS.find((item) => item.id === reason)?.words ?? reason).join(', ')}`}
              </p>
              {answer.note.trim() && <p className="lr-hint">“{answer.note.trim()}”</p>}
              {answer.failed && <p className="lr-hint">Could not play: {answer.failed}</p>}
              <ul className="lr-variants">
                {LABELS.map((label) => (
                  <li key={label}>
                    <b>{label} was {name(trial.labels[label])}</b>, heard {answer.replays[label]} {answer.replays[label] === 1 ? 'time' : 'times'}: {playedWords(answer.played[label])}
                    {levelWords(answer.played[label]) && <span className="lr-hint lr-level-words">{levelWords(answer.played[label])}</span>}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>

      <div className="lr-start-actions">
        <button type="button" className="primary" onClick={() => void copy()}>Copy the results</button>
        <button type="button" onClick={download}>Download the results</button>
        <button type="button" className="lr-quiet" onClick={onBack}>Back to the last transition</button>
        <button type="button" className="lr-quiet" onClick={onNew}>Start a new session</button>
      </div>
      <p className="lr-status" role="status">{said}</p>
    </section>
  );
}
