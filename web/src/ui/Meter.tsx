import { ReactNode, useId, useRef } from 'react';

/** One bar for every "how far along" and "how full": an import's progress, storage used, turns
 * left this month. It says its words aloud as well as drawing them, and its colour comes from the
 * status tokens, never alone: the words always say the same thing.
 *
 * - `kind="progress"` (the default) is work moving towards done, `role="progressbar"`. With no
 *   `value` it is indeterminate: something is happening and nobody knows how much is left.
 * - `kind="meter"` is a quantity within a known range, such as storage used, `role="meter"`.
 *
 * The tone comes from `warnAt` and `dangerAt`, fractions of `max` (0.8 means 80 percent full),
 * unless `tone` says outright. */
export type MeterTone = 'neutral' | 'ready' | 'warning' | 'danger';

export type MeterProps = {
  label: string;
  value?: number;
  max?: number;
  /** what a screen reader hears and the label row shows, such as "312 of 2,898 songs" */
  valueText?: string;
  kind?: 'progress' | 'meter';
  warnAt?: number;
  dangerAt?: number;
  tone?: MeterTone;
  /** false hides the label row visually; the bar keeps its name either way */
  showLabel?: boolean;
  /** extra detail under the bar, such as when an allowance resets */
  detail?: ReactNode;
  className?: string;
};

export function meterTone(fraction: number, warnAt?: number, dangerAt?: number): MeterTone {
  if (dangerAt !== undefined && fraction >= dangerAt) return 'danger';
  if (warnAt !== undefined && fraction >= warnAt) return 'warning';
  return 'neutral';
}

export function Meter({ label, value, max = 100, valueText, kind = 'progress', warnAt, dangerAt, tone, showLabel = true, detail, className = '' }: MeterProps) {
  const labelId = useId();
  const known = value !== undefined && Number.isFinite(value);
  const top = max > 0 ? max : 1;
  const clamped = known ? Math.min(Math.max(value, 0), top) : 0;
  const fraction = clamped / top;
  const status = tone ?? (known ? meterTone(fraction, warnAt, dangerAt) : 'neutral');
  const percent = Math.round(fraction * 100);
  const words = valueText ?? (known ? `${percent} percent` : undefined);
  // Work that reaches done while it is on screen says so once: data-complete, which the feel's depth
  // turns into a single bloom (styles/feel-components.css). A bar drawn already full, or a meter of
  // a quantity (storage that is full is not an achievement), never carries it.
  const wasShort = useRef(false);
  if (known && fraction < 1) wasShort.current = true;
  const complete = kind === 'progress' && known && fraction >= 1 && wasShort.current;
  return (
    <div className={`meter ${className}`.trim()} data-status={status} data-indeterminate={known ? undefined : 'true'} data-complete={complete ? '' : undefined}>
      <div className={`meter-label${showLabel ? '' : ' visually-hidden'}`}>
        <span id={labelId}>{label}</span>
        {words && <span className="meter-value" aria-hidden="true">{words}</span>}
      </div>
      <div
        className="meter-track"
        role={kind === 'meter' ? 'meter' : 'progressbar'}
        aria-labelledby={labelId}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? top : undefined}
        aria-valuenow={known ? clamped : undefined}
        aria-valuetext={known ? words : valueText}
        aria-busy={kind === 'progress' && !known ? true : undefined}
      >
        <i className="meter-fill" style={{ inlineSize: known ? `${fraction * 100}%` : undefined }} />
      </div>
      {detail && <p className="meter-detail">{detail}</p>}
    </div>
  );
}
