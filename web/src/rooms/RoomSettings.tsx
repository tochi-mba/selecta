import { useId, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Field } from '../ui/primitives';
import { NumberField, RoomLimits, type LimitBounds, type LimitSettings } from './RoomLimits';

// The host's room settings, grouped under plain headings: Who can join, Requests, Limits. Each
// change is saved the moment it is made; the group it belongs to says "Saved" beside its heading
// once the server has answered, so the host knows it took without looking for a Save button.

export type RoomSettingsValue = {
  join_mode: string; request_mode: string; votes: boolean; names_shown: boolean; display: boolean;
  replay_cooldown_minutes?: number;
} & LimitSettings;
export type SettingsGroup = 'join' | 'requests' | 'limits';

const JOIN_HELP: Record<string, string> = {
  anyone: 'Anyone who scans the QR code or opens the link is in straight away.',
  approve: 'New guests wait under Guests until you let them in.',
  locked: 'Nobody new can join. Guests already here stay.',
};
const REQUEST_HELP: Record<string, string> = {
  auto: 'Every request goes straight to your Requests list, ready for you to add to the mix.',
  approve: 'Each request waits on this page until you approve it or pass on it.',
  off: 'Guests can see what is playing but can’t ask for songs.',
};
const REPLAY_RANGE: [number, number] = [0, 24 * 60];

function Group({ title, saved, children }: { title: string; saved: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <div className="room-group" role="group" aria-labelledby={id}>
      <header className="room-group-head">
        <h4 id={id}>{title}</h4>
        {/* always in the page, so the change is announced when the words arrive */}
        <span className="room-saved" role="status">{saved && <><Icon name="check" size="compact" /> Saved</>}</span>
      </header>
      {children}
    </div>
  );
}

export function RoomSettings({ settings, bounds, votesOn, saved, save }: {
  settings: RoomSettingsValue;
  bounds?: LimitBounds;
  votesOn: boolean;
  /** the group whose last change the server has just kept */
  saved: SettingsGroup | null;
  save: (change: Partial<RoomSettingsValue>, group: SettingsGroup) => void;
}) {
  const replay = settings.replay_cooldown_minutes ?? 20;
  return (
    <div className="room-settings" data-testid="room-settings">
      <Group title="Who can join" saved={saved === 'join'}>
        <Field label="New guests" help={JOIN_HELP[settings.join_mode]}>
          {(field) => (
            <select {...field} value={settings.join_mode} onChange={(event) => save({ join_mode: event.target.value }, 'join')}>
              <option value="anyone">Anyone with the code</option>
              <option value="approve">I approve each new guest</option>
              <option value="locked">Nobody new</option>
            </select>
          )}
        </Field>
        <label className="room-check">
          <input type="checkbox" checked={settings.names_shown} onChange={(event) => save({ names_shown: event.target.checked }, 'join')} /> Show guest nicknames to everyone
        </label>
        <p className="room-help">{settings.names_shown ? 'Guests see who asked for each song.' : 'Only you see who asked for each song.'}</p>
      </Group>

      <Group title="Requests" saved={saved === 'requests'}>
        <Field label="When a guest asks for a song" help={REQUEST_HELP[settings.request_mode]}>
          {(field) => (
            <select {...field} value={settings.request_mode} onChange={(event) => save({ request_mode: event.target.value }, 'requests')}>
              <option value="auto">Accept automatically</option>
              <option value="approve">I approve each</option>
              <option value="off">Off</option>
            </select>
          )}
        </Field>
        {votesOn && settings.request_mode !== 'off' && (
          <>
            <label className="room-check">
              <input type="checkbox" checked={settings.votes} onChange={(event) => save({ votes: event.target.checked }, 'requests')} /> Guests can vote
            </label>
            <p className="room-help">Guests can back a song someone else asked for.</p>
          </>
        )}
      </Group>

      {settings.request_mode !== 'off' && (
        <Group title="Limits" saved={saved === 'limits'}>
          <RoomLimits settings={settings} bounds={bounds} save={(change) => save(change, 'limits')} />
          <NumberField
            label="Minutes before a song can be asked for again"
            help={replay === 0 ? 'A song can be asked for again as soon as it has played.' : `A song that played in the last ${replay} minutes can’t be asked for.`}
            value={replay} min={REPLAY_RANGE[0]} max={REPLAY_RANGE[1]}
            onSave={(value) => save({ replay_cooldown_minutes: value }, 'limits')}
          />
        </Group>
      )}
    </div>
  );
}
