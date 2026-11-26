import { useId, useRef, useState } from 'react';
import { Dialog } from '../ui/controls';
import { countOf } from '../ui/format';
import { success, tick } from '../feel/haptics';
import { useFeelPart } from '../rooms/feelHooks';
import { defaultAwayWords, telling, type Candidate, type PickerOption } from './whereToPlay';
import './devices.css';

// ADR-0475 rule 4, "Where should the music play?": two or more of the person's devices could make
// the sound and none is a usable default, so they choose; nothing is chosen silently. A real
// dialog (the shared Dialog: focus trap, Escape, focus returned), a radio group the arrow keys
// move through, the suggested device first and marked once, unusable devices listed disabled with
// their reason. Cancelling plays nothing and chooses nothing. "Make this my default" is saved on
// Confirm even if the start then fails: it is the stated wish.

const FORGOTTEN_AFTER_S = 30 * 86_400;
/** A device with none of these songs itself, playing them from the cloud library. */
const CLOUD_ROW = 'From your cloud library';
const seenWords = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 90) return `Last seen ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(minutes / 60);
  return hours < 36 ? `Last seen ${hours} hours ago` : `Last seen ${Math.round(hours / 24)} days ago`;
};

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
  // ADR-0477: the device just chosen here shows a drawn tick; the first, suggested choice does not
  const [changedTo, setChangedTo] = useState<string | null>(null);
  const moving = useFeelPart('motion');
  const pick = (id: string) => { tick(); setPicked(id); setChangedTo(id); };
  const [makeDefault, setMakeDefault] = useState(false);
  const chosen = shown.find((option) => option.device.device_id === picked);
  // choices are the open devices; the rest are named under one collapsed row, and a device not
  // seen for 30 days is left to the Devices page (Forget)
  const open = shown.filter((option) => option.device.online);
  const away = shown.filter((option) => !option.device.online && now - option.device.last_seen_at < FORGOTTEN_AFTER_S);
  const name = useId();
  const words = (option: PickerOption) => {
    const what = option.held === null ? countOf(option.device.songs, 'song') : total ? (option.held >= total ? `All ${countOf(total, 'song')}` : `${option.held} of ${countOf(total, 'song')}`) : countOf(option.held, 'song');
    const apart = telling(option.device, shown.map((one) => one.device), thisDeviceId, now);
    // the reason without the name: the row already says which device it is
    const why = option.why?.startsWith(option.device.name) ? option.why.slice(option.device.name.length).trim().replace(/^./, (first) => first.toUpperCase()) : option.why;
    // cloud.catalogue_play: said in the row, not a tooltip, so a touch screen shows it too
    const from = !why && option.cloud ? CLOUD_ROW : null;
    return [apart, why ?? what, from].filter(Boolean).join(' · ');
  };
  return (
    <Dialog title="Where should the music play?" onClose={onCancel} className="speaker-picker" footer={(
      <>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={!chosen?.usable} onClick={() => { if (!chosen) return; success(); onChoose(chosen.device, makeDefault); }}>
          {chosen ? `Play on ${chosen.device.device_id === thisDeviceId ? 'this device' : chosen.device.name}` : 'Play'}
        </button>
      </>
    )}>
      {defaultAway && <p className="speaker-picker-note" role="status">{defaultAwayWords(defaultAway.name)}</p>}
      {chosen && !chosen.usable && <p className="speaker-picker-note" role="status">{chosen.why}</p>}
      <div role="radiogroup" aria-label="Devices" className="speaker-picker-list">
        {open.map((option) => (
          <label key={option.device.device_id} className="speaker-picker-row" data-usable={option.usable || undefined}>
            <input type="radio" name={name} value={option.device.device_id} checked={picked === option.device.device_id} disabled={!option.usable}
              onChange={() => pick(option.device.device_id)} aria-label={`${option.device.name}: ${words(option)}`} />
            <span className="speaker-picker-words">
              <b dir="auto" title={option.device.name}>{option.device.name}</b>
              <span>{words(option)}</span>
            </span>
            {option.device.device_id === suggested && option.usable && <span className="badge" data-tone="accent">Suggested</span>}
            {moving && changedTo === option.device.device_id && picked === changedTo && (
              <svg key={changedTo} className="speaker-picker-tick" viewBox="0 0 24 24" aria-hidden="true"><path className="feel-tick" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            )}
          </label>
        ))}
      </div>
      {away.length > 0 && (
        // devices that are not open are not choices: named once, out of the way
        <details className="speaker-picker-away">
          <summary>Not open right now ({away.length})</summary>
          <ul>
            {away.map((option) => (
              <li key={option.device.device_id}><b dir="auto">{option.device.name}</b> <span>{seenWords(now - option.device.last_seen_at)}</span></li>
            ))}
          </ul>
        </details>
      )}
      <label className="speaker-picker-default">
        <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
        Make this my default
      </label>
    </Dialog>
  );
}
