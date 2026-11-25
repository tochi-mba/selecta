import { CSSProperties, useSyncExternalStore } from 'react';
import { feelOn, onFeelChange } from './root';

/** A number that rolls to its new value, digit by digit, like a counter (ADR-0477).
 *
 * Each digit is a strip of 0 to 9 moved by transform, so a change costs no layout. The strips are
 * decoration (aria-hidden); the words a screen reader hears, and what is copied, are always the
 * final formatted value. Digits are tabular, so the width never jitters while it rolls. The roll
 * takes `--motion-spring-snappy` (320ms, never more than 600ms), and without data-feel~='motion'
 * (Still, reduced motion, low power, or the flag off) the value simply changes in place.
 * Styles: styles/feel-parts.css (.number-roll). */
export function NumberRoll({ value, format, className }: {
  value: number;
  /** How the number is written; the default is this browser's own grouping. */
  format?: (value: number) => string;
  className?: string;
}) {
  const moving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
  const text = format ? format(value) : value.toLocaleString();
  const classes = `number-roll${className ? ` ${className}` : ''}`;
  if (!moving) return <span className={classes}>{text}</span>;
  const chars = [...text];
  return (
    <span className={classes}>
      <span className="visually-hidden">{text}</span>
      <span className="number-roll-digits" aria-hidden="true">
        {chars.map((char, index) => {
          // keyed from the right, so the units column stays the units column when the number grows
          const key = chars.length - index;
          if (!/[0-9]/.test(char)) return <span key={`c${key}`} className="number-roll-mark">{char}</span>;
          return (
            <span key={`d${key}`} className="number-roll-col">
              <span className="number-roll-strip" style={{ '--digit': Number(char) } as CSSProperties}>
                {DIGITS.map((digit) => <span key={digit}>{digit}</span>)}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
