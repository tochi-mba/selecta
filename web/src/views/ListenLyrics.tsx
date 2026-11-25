// Listen's lyrics, split out of Now.tsx (file length limit), with their feel (ADR-0477, plan 3.4).
//
// With the motion part off (the flag, Still, the computer's reduced-motion setting or the second
// low-power step) this draws exactly what Now.tsx drew before: the current line highlighted, nothing
// moving. With it on, and only from the real song clock:
// - the line being sung grows a little and glows (feel-listen.css), arriving as the clock reaches it;
// - where the lyrics really carry word timing, the words already sung stay lit and the rest of the
//   line waits a shade softer, so the light runs along the line as it is sung;
// - when the clock moves on to the next line, the lines glide up into place from where they were,
//   like a smooth scroll, instead of jumping. A seek that lands further away just redraws.
import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SongDetail } from '../api';
import { flagOn } from '../flags';
import { feelCalm } from '../feel/root';
import { motionMs } from '../ui/exitMotion';
import { useMediaQuery } from '../ui/useMediaQuery';
import { springOf, useFeelPart } from './feelBits';

const LYRIC_WORD = /^[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?$/u;

/** A line split into its words, the one being sung marked, and the words before `litUpTo` (already
 * sung) marked too. Only words are counted, the same way word timing counts them. */
export function highlightedLine(text: string, activeWord: number, litUpTo = -1) {
  let word = 0;
  return text.split(/([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?)/gu).map((part, index) => {
    if (!LYRIC_WORD.test(part)) return part;
    const current = word === activeWord;
    const sung = word < litUpTo && word !== activeWord;
    word += 1;
    return (
      <span key={index} className={current ? 'current-word' : sung ? 'sung-word' : undefined}>
        {part}
      </span>
    );
  });
}

function upperBound(points: number[], value: number) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Why there's nothing to follow along with. A song's timing is never made up to fill the gap. */
function noLyricsWords(status: string | null | undefined): string {
  switch (status) {
    case 'instrumental': return 'Instrumental';
    case 'plain': return 'Lyrics for this song aren’t timed, so they can’t follow along.';
    case 'failed': return 'Looking up lyrics for this song didn’t work. SelectaDJ will try again later.';
    case 'synced': return 'The timed lyrics for this song couldn’t be read.';
    case null:
    case undefined: return 'Lyrics haven’t been looked up yet.';
    default: return 'No lyrics found for this song.';
  }
}

/** The lines glide up when the clock moves on by one line. The current line's place is measured in
 * the render before the change (the page still shows the old lines then), and after it the line that
 * was current sits one place up; every line starts from that distance below and settles. */
function useLineGlide(box: RefObject<HTMLDivElement | null>, index: number, on: boolean) {
  const shown = useRef(index);
  const before = useRef<number | null>(null);
  if (shown.current !== index) {
    before.current = on && index === shown.current + 1
      ? box.current?.querySelector<HTMLElement>('[data-lyric="current"]')?.getBoundingClientRect().top ?? null
      : null;
    shown.current = index;
  }
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    const node = box.current;
    if (was === null || !node || !on || feelCalm()) return;
    const now = node.querySelector<HTMLElement>('[data-lyric="previous"]')?.getBoundingClientRect().top;
    const distance = now === undefined ? 0 : was - now;
    if (!distance) return;
    const duration = motionMs('--motion-spring-snappy', 320);
    if (!duration) return;
    const easing = springOf('--spring-gentle');
    for (const line of Array.from(node.querySelectorAll<HTMLElement>(':scope > p[data-lyric]'))) {
      if (typeof line.animate !== 'function') continue;
      // the translate property, so the current line's own grow (scale) is left alone
      line.animate([{ translate: `0 ${distance}px` }, { translate: '0 0' }], { duration, easing });
    }
  }, [index, on, box]);
}

export function Lyrics({ detail, time, focus, canBrowse = false }: { detail: SongDetail; time: number; focus?: boolean; canBrowse?: boolean }) {
  // Reading belongs to the song it was opened on, so a new song follows again. It's derived, not reset
  // in an effect: a mount effect that ran after a quick first press would undo that press.
  const [readingId, setReadingId] = useState<number | null>(null);
  const reading = readingId === detail.id;
  // and once another song is shown it is forgotten, so coming back to this one follows again
  if (readingId !== null && !reading) setReadingId(null);
  // On a phone the first screen is the song and its words, and anything to press starts below it, so
  // nothing sits half hidden behind the player at whatever height the phone is (listening.css). The
  // button comes after the words there, in the page as well as on screen, so Tab meets it where it is.
  const phone = useMediaQuery('(max-width: 760px)');
  const lines = detail.lines;
  const starts = useMemo(() => lines.map((line) => line.start), [lines]);
  // Audio ticks many times per second; a long lyric sheet should not be
  // scanned linearly on every tick just to find the current phrase.
  const index = useMemo(() => upperBound(starts, time + 0.1) - 1, [starts, time]);
  // the motion part is already off under Still, reduced motion and the second low-power step
  const moving = useFeelPart('motion');
  const box = useRef<HTMLDivElement>(null);
  useLineGlide(box, index, moving && !reading);
  // the space stays the same whichever it is, so the page doesn't jump about between songs
  if (!lines.length) {
    return <div className={`lyrics quiet ${focus ? 'focus' : ''}`}><p className="dim">{noLyricsWords(detail.lyric_status)}</p></div>;
  }
  const singing = index >= 0 && time < lines[index].end + 1.5;
  const current = index >= 0 ? lines[index] : null;
  const wordIndex = current?.words?.findIndex((word) => word.start <= time && time < word.end) ?? -1;
  // the words before the one being sung, or every word whose time has come between two words, are lit
  const sungUpTo = current?.words?.length ? (wordIndex >= 0 ? wordIndex : upperBound(current.words.map((word) => word.start), time)) : -1;
  const around = focus ? 3 : 1;
  const words = flagOn('listen.word_focus');
  const timed = moving && singing && words && !!current?.words?.length;
  const timingWords = detail.lyric_status === 'plain'
    ? 'Untimed lyrics - word timing unavailable.'
    : words && lines.some((line) => !!line.words?.length)
      ? 'Word highlights follow stored lyric alignment; timing may be approximate.'
      : 'Line-timed lyrics; individual word timing unavailable.';
  const browse = canBrowse && (
    <button type="button" className="lyrics-browse" aria-pressed={reading} onClick={() => setReadingId(reading ? null : detail.id)}>
      {reading ? 'Resume lyric follow' : 'Read all lyrics'}
    </button>
  );
  // marks for the glide and the grow, only with motion on, so the page is as before without it
  const mark = (role: string) => (moving ? role : undefined);
  return (
    <div ref={box} className={`lyrics ${focus ? 'focus' : ''} ${reading ? 'reading' : ''}`} aria-live="off">
      <p className="lyric-confidence">{timingWords}</p>
      {!phone && browse}
      {reading ? (
        <div className="lyrics-scroll" tabIndex={0} role="region" aria-label="All timed lyrics, scroll manually">
          {lines.map((line, at) => (
            <p key={at} dir="auto" className={at === index && singing ? 'sung' : 'dim'}>{line.text}</p>
          ))}
        </div>
      ) : (
        <>
      {Array.from({ length: around }, (_, gap) => around - gap).map((back) => (
        <p dir="auto" className="dim" key={`before-${back}`} data-lyric={mark(back === 1 ? 'previous' : 'line')}>{lines[index - back]?.text ?? ' '}</p>
      ))}
      {/* with motion on, each line is its own element, so the clock reaching it is its arrival */}
      <p dir="auto" className={singing ? 'sung' : 'dim'} key={moving ? `line-${index}` : 'current'} data-lyric={mark('current')} data-words={timed ? 'timed' : undefined}>
        {current ? highlightedLine(current.text, singing && words ? wordIndex : -1, timed ? sungUpTo : -1) : ' '}
      </p>
      {Array.from({ length: around }, (_, gap) => gap + 1).map((ahead) => (
        <p dir="auto" className="dim" key={`after-${ahead}`} data-lyric={mark('line')}>{lines[index + ahead]?.text ?? ' '}</p>
      ))}
        </>
      )}
      {phone && browse}
    </div>
  );
}
