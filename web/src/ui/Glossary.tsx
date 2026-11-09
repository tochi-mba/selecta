import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { closeGlossary, openGlossary, useGlossaryRequests } from '../state/glossaryRequests';
import { setPrefs, usePrefs } from '../state/prefs';
import { Dialog } from './controls';
import { glossaryOn, glossaryTerm, GlossaryTerm, searchGlossary } from './glossaryTerms';
import { useFlag } from '../flags';
import { Field } from './primitives';

/** Plain words for music terms, findable from anywhere. Reading them never plays, changes or saves
 * anything except the one local choice of whether the small ? hints show. */

const anchorOf = (id: string) => `glossary-term-${id}`;

function GlossaryEntry({ entry, onJump }: { entry: GlossaryTerm; onJump: (id: string) => void }) {
  const related = (entry.related ?? []).map(glossaryTerm).filter((other): other is GlossaryTerm => !!other);
  return (
    <li className="glossary-entry">
      <h3 id={anchorOf(entry.id)} tabIndex={-1}>{entry.term}</h3>
      {!!entry.aka?.length && <p className="hint glossary-aka">Also: {entry.aka.join(', ')}</p>}
      <p>{entry.plain}</p>
      {entry.effect && <p><b>What it changes:</b> {entry.effect}</p>}
      {entry.reversible && <p><b>Taking it back:</b> {entry.reversible}</p>}
      {related.length > 0 && (
        <p className="glossary-related">
          <span className="hint">See also:</span>
          {related.map((other) => (
            <button key={other.id} type="button" className="link" onClick={() => onJump(other.id)}>{other.term}</button>
          ))}
        </p>
      )}
    </li>
  );
}

/** Every term, with a search that ignores case and accents. Opened at a term, it starts there. */
export function GlossaryDialog({ initialTerm, onClose }: { initialTerm?: string | null; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [focusOn, setFocusOn] = useState<string | null>(initialTerm && glossaryTerm(initialTerm) ? initialTerm : null);
  const preferences = usePrefs();
  const shown = useMemo(() => searchGlossary(query), [query]);
  const listId = useId();
  const text = query.trim();

  // After the dialog has put focus in its search box, a requested term takes it, in view.
  useEffect(() => {
    if (!focusOn) return;
    if (!shown.some((entry) => entry.id === focusOn)) return;
    const heading = document.getElementById(anchorOf(focusOn));
    heading?.scrollIntoView?.({ block: 'start' });
    heading?.focus({ preventScroll: true });
    setFocusOn(null);
  }, [focusOn, shown]);

  const jump = (id: string) => {
    // a related term the search has hidden comes back into the list first
    if (!shown.some((entry) => entry.id === id)) setQuery('');
    setFocusOn(id);
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) {
      // the first Escape clears the search, the next one closes
      event.stopPropagation();
      setQuery('');
    }
  };

  const count = !text
    ? `${glossaryOn().length} music terms.`
    : shown.length
      ? `${shown.length} ${shown.length === 1 ? 'term matches' : 'terms match'} “${text}”.`
      : `No terms match “${text}”. Try another word, like tempo or bridge.`;

  return (
    <Dialog title="Music terms" onClose={onClose} footer={<button onClick={onClose}>Close</button>}>
      <div className="glossary">
        <p className="hint">What Selecta’s music words mean, what each one changes, and how to take it back. Reading these never changes anything.</p>
        <Field label="Search music terms" help="Case and accents don’t matter.">
          {(field) => (
            <input
              {...field}
              data-autofocus
              type="search"
              autoComplete="off"
              spellCheck={false}
              aria-controls={listId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={keys}
            />
          )}
        </Field>
        <p className="hint glossary-count" role="status" aria-live="polite">{count}</p>
        <ul id={listId} className="glossary-list" aria-label="Music terms">
          {shown.map((entry) => <GlossaryEntry key={entry.id} entry={entry} onJump={jump} />)}
        </ul>
        <label className="choice glossary-hints-choice">
          <input type="checkbox" checked={preferences.termHints} onChange={(event) => setPrefs({ termHints: event.target.checked })} />
          Show ? hints next to music terms
        </label>
        <p className="hint">This only hides the small ? buttons. Warnings, problems, anything that needs your OK, and every status always show.</p>
      </div>
    </Dialog>
  );
}

/** The app's one glossary, opened by whoever asks for it. */
export function GlossaryHost() {
  const request = useGlossaryRequests();
  if (!request.open) return null;
  return <GlossaryDialog key={request.asked} initialTerm={request.term} onClose={closeGlossary} />;
}

/** A small ? beside a music term. It opens a short definition right here, with a way to the full
 * list. Enter, Space or a tap open and close it, and Escape closes it and returns to the ?. With
 * hints turned off it isn't there at all. It's never the only place anything important is said. */
export function TermHint({ term, label }: { term: string; label?: string }) {
  const entry = glossaryTerm(term);
  const preferences = usePrefs();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const glossary = useFlag('app.glossary');
  if (!entry || !preferences.termHints || !glossary) return null;
  // "What is studio lane?", but BPM and Selecta stay as they're written
  const name = label ?? (/^[A-Z][a-z]/.test(entry.term) && !entry.term.startsWith('Selecta') ? entry.term[0].toLowerCase() + entry.term.slice(1) : entry.term);
  return (
    <span
      className="term-hint"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // the innermost thing closes first, not the dialog or page around it
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="term-hint-button"
        aria-label={`What is ${name}?`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <span id={panelId} className="term-hint-panel">
          <b>{entry.term}.</b> {entry.plain}
          <button type="button" className="link term-hint-more" onClick={() => openGlossary(entry.id)}>All music terms</button>
        </span>
      )}
    </span>
  );
}
