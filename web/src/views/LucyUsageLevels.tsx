import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { LADDER_SEGMENTS, leftWords, lineWords, stateWords, usageLines, useLucyUsageNews, type LucyUsageLine, type LucyWindows } from '../cloud/lucyUsage';
import { usePresence } from '../ui/exitMotion';
import { growFrom } from '../ui/primitives';
import '../styles/lucy.css';

/** The twin level meter (ADR-0484 rule 11): two ladders of five segments side by side, like the
 * channel meters on a mixer. The left ladder is this session, the right is this week, so both limits
 * are in sight wherever Lucy is open. Resting on it, reaching it with the keyboard or tapping it
 * opens a small label with both lines and a way to the full meter in Lucy's settings. It never opens
 * a plan or a purchase, and it is not drawn at all until the server sends the new figures. */

/** Only a pointer that can really hover opens the label by resting on it. */
const HOVERS = '(hover: hover) and (pointer: fine)';
const canHover = () => typeof window.matchMedia === 'function' && window.matchMedia(HOVERS).matches;

/** One ladder, lit from the bottom. Near carries a marker above it; spent is drawn empty with a
 * dashed outline (lucy.css), so the states differ by shape as well as by the words in the label. */
function Ladder({ line }: { line: LucyUsageLine }) {
  const { state, segments } = line.window;
  const lit = state === 'spent' ? 0 : segments;
  return (
    <span className="lucy-ladder" data-kind={line.kind} data-state={state}>
      {state === 'near' && <i className="lucy-ladder-mark" />}
      <span className="lucy-ladder-rungs">
        {Array.from({ length: LADDER_SEGMENTS }, (_, index) => LADDER_SEGMENTS - index).map((rung) => (
          <i key={rung} className="lucy-ladder-seg" data-lit={rung <= lit || undefined} />
        ))}
      </span>
    </span>
  );
}

export function LucyUsageLevels({ windows, onSettings }: {
  windows: LucyWindows | null;
  /** Opens the full meter in Lucy's settings; without it the label has no link. */
  onSettings?: () => void;
}) {
  // why the label is open: pinned by a tap or click, a fine pointer resting on it, or the keyboard
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = !!windows && (pinned || hovered || focused);
  const holder = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // a press focuses the button before its click arrives, and Escape hands the focus back: neither
  // is the keyboard reaching it, so neither opens the label by itself
  const pressing = useRef(false);
  const quiet = useRef(false);
  const id = useId();
  const shown = usePresence<HTMLDivElement>(open);
  useLucyUsageNews(windows);
  const close = () => { setPinned(false); setHovered(false); setFocused(false); };

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent | TouchEvent) => {
      if (!holder.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away, { passive: true });
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open) growFrom(shown.ref.current, opener.current);
  }, [open]);

  if (!windows) return null;
  const lines = usageLines(windows);
  const name = `Lucy usage: ${lines.map((line) => `${leftWords(line.window)} ${line.name.toLowerCase()}`).join(', ')}`;
  return (
    <span
      className="lucy-levels"
      ref={holder}
      onMouseEnter={() => { if (canHover()) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      onBlur={(event) => {
        pressing.current = false;
        if (!holder.current?.contains(event.relatedTarget as Node | null)) { setFocused(false); setPinned(false); }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        close();
        if (document.activeElement !== opener.current) {
          quiet.current = true;
          opener.current?.focus();
          quiet.current = false;
        }
      }}
    >
      <button
        ref={opener}
        type="button"
        className="lucy-levels-button"
        aria-label={name}
        aria-expanded={open}
        aria-controls={id}
        onPointerDown={() => { pressing.current = true; }}
        onMouseDown={() => { pressing.current = true; }}
        onFocus={() => { if (!pressing.current && !quiet.current) setFocused(true); }}
        onClick={() => {
          pressing.current = false;
          if (pinned) close();
          else setPinned(true);
        }}
      >
        <span className="lucy-levels-pair" aria-hidden="true">
          {lines.map((line) => <Ladder key={line.kind} line={line} />)}
        </span>
      </button>
      {shown.present && (
        <div
          ref={shown.ref}
          id={id}
          className="popover-panel lucy-levels-panel"
          data-motion="pop"
          data-closing={shown.closing ? '' : undefined}
          aria-hidden={shown.closing || undefined}
          inert={shown.closing || undefined}
        >
          {lines.map((line) => {
            const state = stateWords(line.window.state);
            return (
              <p key={line.kind} className="lucy-levels-line" data-state={line.window.state}>
                <b>{line.name}:</b> {lineWords(line.window, line.kind)}{state ? <span className="lucy-levels-state"> · {state}</span> : null}
              </p>
            );
          })}
          {windows.lighter && <p className="lucy-levels-line soft">A lighter Lucy is answering until this session ends.</p>}
          {onSettings && (
            <button type="button" className="lucy-link" onClick={() => { close(); onSettings(); }}>See the full meter in Lucy’s settings</button>
          )}
        </div>
      )}
    </span>
  );
}
