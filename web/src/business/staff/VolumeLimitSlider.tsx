// VolumeLimitSlider (ADR-0453 D10, D14): the existing Slider, with the venue's cap drawn as a mark
// and said in words ("Up to 70 here"). The range itself ends at the cap, so a value above it
// cannot be chosen by pointer, keyboard or assistive tech; the track past the cap is drawn as
// unavailable so the cap reads in proportion to the whole volume.

import type { CSSProperties } from 'react';
import { Slider } from '../../ui/primitives';
import { capWords, volumeValueText } from '../copy/staff';
import './staff.css';

export function clampLevel(level: number, cap: number): number {
  const top = Math.max(0, Math.min(100, Math.round(cap)));
  return Math.max(0, Math.min(top, Math.round(level)));
}

export function VolumeLimitSlider({ label, value, cap, onChange, disabled }: {
  label: string; value: number; cap: number; onChange: (level: number) => void; disabled?: string | null;
}) {
  const top = clampLevel(cap, 100);
  const shown = clampLevel(value, top);
  const style = { '--biz-cap': `${top}%` } as CSSProperties;
  return (
    <div className="biz-volume" style={style} data-cap={top}>
      <div className="biz-volume-head">
        <span className="biz-volume-label" aria-hidden="true">{label}</span>
        <span className="biz-volume-value" aria-hidden="true">{shown}</span>
      </div>
      <div className="biz-volume-track">
        <Slider
          label={label}
          min={0}
          max={top}
          step={1}
          value={shown}
          valueText={volumeValueText(shown, top)}
          disabled={Boolean(disabled)}
          title={disabled ?? undefined}
          onChange={(event) => onChange(clampLevel(Number(event.currentTarget.value), top))}
        />
        <span className="biz-volume-beyond" aria-hidden="true" />
        <span className="biz-volume-mark" aria-hidden="true" />
      </div>
      <p className="biz-quiet biz-volume-cap">{capWords(top)}{disabled ? `. ${disabled}` : ''}</p>
    </div>
  );
}
