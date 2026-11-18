import { createElement, HTMLAttributes } from 'react';

/** How numbers, times and long names are said, once, in the reader's own language. Every page uses
 * these rather than its own helper, so "3 min ago" and "1 songs" can't drift apart again. */

/** The one ellipsis character. Three full stops read as three full stops to a screen reader. */
export const ELLIPSIS = '…';

/** The reader's language, from the browser; undefined lets Intl choose the runtime default. */
export function userLocale(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.languages?.[0] ?? navigator.language ?? undefined;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** How long ago something happened, in the reader's language: "just now", "4 minutes ago",
 * "yesterday". `secondsAgo` is the age; a negative age is in the future ("in 2 hours").
 * Under a minute is "just now" in English and Intl's own word for now elsewhere. */
export function relativeTime(secondsAgo: number, options: { locale?: string; style?: Intl.RelativeTimeFormatStyle } = {}): string {
  const locale = options.locale ?? userLocale();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: options.style ?? 'long' });
  const age = Number.isFinite(secondsAgo) ? secondsAgo : 0;
  const size = Math.abs(age);
  if (size < 60) {
    const language = (format.resolvedOptions().locale || 'en').toLowerCase();
    return language.startsWith('en') ? 'just now' : format.format(0, 'second');
  }
  for (const [unit, length] of UNITS) {
    if (size >= length) return format.format(-Math.trunc(age / length), unit);
  }
  return format.format(-Math.trunc(age / 60), 'minute');
}

/** A count with the right word for it: "1 song", "3 songs", "1,204 songs". The plural defaults to
 * the singular with an s; pass it when it isn't ("1 person", "2 people"). */
export function countOf(count: number, singular: string, plural = `${singular}s`, locale = userLocale()): string {
  const rule = new Intl.PluralRules(locale).select(count);
  return `${new Intl.NumberFormat(locale).format(count)} ${rule === 'one' ? singular : plural}`;
}

/** Shortens text to at most `max` characters, ending with the one ellipsis character. Prefer
 * `Truncate`, which lets CSS do it and keeps the whole text; this is for places with no CSS, such
 * as a document title or a notification. */
export function ellipsize(text: string, max: number): string {
  if (max < 1) return '';
  const letters = [...text];
  if (letters.length <= max) return text;
  return `${letters.slice(0, max - 1).join('').trimEnd()}${ELLIPSIS}`;
}

/** A name that may be too long for its box: one line, cut off with an ellipsis by CSS, the whole
 * name on hover, and `dir="auto"` so a right-to-left title reads the right way round. */
export function Truncate({ text, className = '', ...rest }: Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'title' | 'dir'> & { text: string }) {
  return createElement('span', { ...rest, className: `truncate ${className}`.trim(), title: text, dir: 'auto', style: { ...TRUNCATE_STYLE, ...rest.style } }, text);
}

// Inline so a name is cut cleanly on every surface, whichever sheets that surface loads.
const TRUNCATE_STYLE = { display: 'block', maxInlineSize: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minInlineSize: 0 } as const;
