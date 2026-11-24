import { useId, useRef, useState } from 'react';
import { Dialog } from '../ui/controls';
import { countOf } from '../ui/format';
import { defaultAwayWords, telling, type Candidate, type PickerOption } from './whereToPlay';
import './devices.css';

// ADR-0475 rule 4, "Where should the music play?": two or more of the person's devices could make
// the sound and none is a usable default, so they choose; nothing is chosen silently. A real
// dialog (the shared Dialog: focus trap, Escape, focus returned), a radio group the arrow keys
// move through, the suggested device first and marked once, unusable devices listed disabled with
// their reason. Cancelling plays nothing and chooses nothing. "Make this my default" is saved on
// Confirm even if the start then fails: it is the stated wish.

export function SpeakerPicker({ options, suggested, defaultAway, total, thisDeviceId, now, onChoose, onCancel }: {
  options: readonly PickerOption[];
  suggested: string;
  defaultAway: Candidate | null;
  /** Songs about to play; 0 when not known. */
  total: number;
  thisDeviceId: string | null;
  now: number;
  onChoose: (device: Candidate, makeDefault: boolean) => void;
  onCancel: () => void;
}) {
  // the order is fixed once shown: counts and disabled states update, rows never move
  const order = useRef(options.map((option) => option.device.device_id));
  const known = new Set(order.current);
  for (const option of options) if (!known.has(option.device.device_id)) order.current.push(option.device.device_id);
  const shown = order.current.map((id) => options.find((option) => option.device.device_id === id)).filter((option): option is PickerOption => !!option);
  const [picked, setPicked] = useState(suggested);
  const [makeDefault, setMakeDefault] = useState(false);
  const chosen = shown.find((option) => option.device.device_id === picked);
  const name = useId();
  const words = (option: PickerOption) => {
    const what = option.held === null ? countOf(option.device.songs, 'song') : total ? (option.held >= total ? `All ${countOf(total, 'song')}` : `${option.held} of ${countOf(total, 'song')}`) : countOf(option.held, 'song');
    const apart = telling(option.device, shown.map((one) => one.device), thisDeviceId, now);
    return [apart, option.why ?? what].filter(Boolean).join(' · ');
  };
  return (
    <Dialog title="Where should the music play?" onClose={onCancel} className="speaker-picker" footer={(
      <>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={!chosen?.usable} onClick={() => chosen && onChoose(chosen.device, makeDefault)}>
          {chosen ? `Play on ${chosen.device.device_id === thisDeviceId ? 'this device' : chosen.device.name}` : 'Play'}
        </button>
      </>
    )}>
      {defaultAway && <p className="speaker-picker-note" role="status">{defaultAwayWords(defaultAway.name)}</p>}
      {chosen && !chosen.usable && <p className="speaker-picker-note" role="status">{chosen.why}</p>}
      <div role="radiogroup" aria-label="Devices" className="speaker-picker-list">
        {shown.map((option) => (
          <label key={option.device.device_id} className="speaker-picker-row" data-usable={option.usable || undefined}>
            <input type="radio" name={name} value={option.device.device_id} checked={picked === option.device.device_id} disabled={!option.usable}
              onChange={() => setPicked(option.device.device_id)} aria-label={`${option.device.name}: ${words(option)}`} />
            <span className="speaker-picker-words">
              <b dir="auto" title={option.device.name}>{option.device.name}</b>
              <span>{words(option)}</span>
            </span>
            {option.device.device_id === suggested && option.usable && <span className="badge" data-tone="accent">Suggested</span>}
          </label>
        ))}
      </div>
      <label className="speaker-picker-default">
        <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
        Make this my default
      </label>
    </Dialog>
  );
}
