import { useEffect, useId, useState } from 'react';

// How many songs each guest may ask for, set by the host in the room's Settings.
//
// Two numbers, both the host's own choice and neither tied to a plan: how many songs one guest can
// have waiting at once, and how many they can ask for in an hour (or no hourly limit, which the
// server keeps as 0). The ranges come from the server with the room (`bounds`), so what is offered
// here is exactly what it accepts; the fallbacks match rooms/settings.py. A number is saved when
// the host leaves the field or presses Enter, never on each keystroke.

export type LimitSettings = {
  pending_per_guest?: number;
  requests_per_guest_per_hour?: number;
  max_guests?: number;
  max_hours?: number;
};
export type LimitBounds = Partial<Record<'pending_per_guest' | 'requests_per_guest_per_hour' | 'pending_per_room', [number, number]>>;

const WAITING_RANGE: [number, number] = [1, 20];
const HOURLY_RANGE: [number, number] = [0, 60];
const HOURLY_DEFAULT = 20;

export function NumberField({ label, help, value, min, max, disabled, onSave }: {
  label: string; help: string; value: number; min: number; max: number; disabled?: boolean; onSave: (value: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  // the saved number, whenever it changes under the field (a save answered, another device)
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const typed = Math.round(Number(draft));
    if (!draft.trim() || !Number.isFinite(typed)) { setDraft(String(value)); return; }
    const kept = Math.min(max, Math.max(min, typed));
    setDraft(String(kept));
    if (kept !== value) onSave(kept);
  };
  return (
    <div className="room-limit">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} type="number" inputMode="numeric" min={min} max={max} step={1} value={draft} disabled={disabled}
        aria-describedby={`${id}-help`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
      />
      <p className="room-help" id={`${id}-help`}>{help} {min} to {max}.</p>
    </div>
  );
}

export function RoomLimits({ settings, bounds, save }: {
  settings: LimitSettings;
  bounds?: LimitBounds;
  save: (change: LimitSettings) => void;
}) {
  const [waitingMin, waitingMax] = bounds?.pending_per_guest ?? WAITING_RANGE;
  const [, hourlyMax] = bounds?.requests_per_guest_per_hour ?? HOURLY_RANGE;
  const waiting = settings.pending_per_guest ?? 3;
  const hourly = settings.requests_per_guest_per_hour ?? HOURLY_DEFAULT;
  const noHourly = hourly === 0;
  // what the hourly limit goes back to when "No hourly limit" is unticked
  const [lastHourly, setLastHourly] = useState(hourly || HOURLY_DEFAULT);
  useEffect(() => { if (hourly > 0) setLastHourly(hourly); }, [hourly]);
  const plan = [
    settings.max_guests ? `up to ${settings.max_guests} guests` : '',
    settings.max_hours ? `open for up to ${settings.max_hours} hours` : '',
  ].filter(Boolean).join(', ');
  return (
    <div className="room-limits" data-testid="room-limits">
      <NumberField
        label="Songs a guest can have waiting at once"
        help="After that, a guest waits until one of their songs is added or passed on."
        value={waiting} min={waitingMin} max={waitingMax}
        onSave={(value) => save({ pending_per_guest: value })}
      />
      <NumberField
        label="Songs a guest can ask for per hour"
        help={noHourly ? 'Only the waiting limit above holds a guest back.' : 'Counts every song a guest asked for in the last 60 minutes.'}
        value={noHourly ? lastHourly : hourly} min={1} max={hourlyMax} disabled={noHourly}
        onSave={(value) => save({ requests_per_guest_per_hour: value })}
      />
      <label className="room-check">
        <input type="checkbox" checked={noHourly} onChange={(event) => save({ requests_per_guest_per_hour: event.target.checked ? 0 : lastHourly })} /> No hourly limit
      </label>
      {plan && <p className="room-help">Your plan allows {plan}.</p>}
    </div>
  );
}
