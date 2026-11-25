import { useEffect, useRef, useState } from 'react';
import { Action } from '../ui/controls';
import { Field } from '../ui/primitives';
import { NumberField } from './RoomLimits';
import { SettingsSection } from './RoomSettings';
import type { RoomAsk } from './useRoomSession';

// What a room does together, in the host's settings (ADR-0488): three more groups after Limits.
//
// - Together: what guests can do beyond asking for songs. Each line is there only while its
//   feature is on for this account, so a feature that is off leaves no words behind.
// - Pick the next song: the button that starts a vote, and how votes run.
// - Big screen shows: what a paired screen adds. Every feature works on phones alone, so this
//   group exists only while a screen is paired; with none it is absent, not greyed out.

export type SocialSettings = {
  keeps: boolean; reactions: boolean; rounds: boolean; round_seconds: number; round_every_songs: number;
  round_auto_add: boolean; dedications: boolean; dedications_hidden: string[]; recap: boolean;
  screen_rounds: boolean; screen_reactions: boolean; screen_dedications: boolean; screen_recap: boolean;
};
export type SocialGroup = 'together' | 'rounds' | 'screen';
export type SocialOn = { keeps: boolean; reactions: boolean; rounds: boolean; dedications: boolean; recap: boolean };

type Api = <T>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>;
type Option = { song_id: number; votes: number; song?: { title?: string; artist?: string } | null };
type Round = { round_id: string; state: string; closes_at: number; total: number; options: Option[]; winner?: { song_id?: number; song?: { title?: string } | null } | number | null };
type Pulse = { now: number; round?: Round | null };

const ANSWER_MS = 7000;
const EVERY = [0, 2, 3, 4, 5, 6, 8, 10];

function Check({ label, help, checked, change }: { label: string; help: string; checked: boolean; change: (next: boolean) => void }) {
  return (
    <>
      <label className="room-check"><input type="checkbox" checked={checked} onChange={(event) => change(event.target.checked)} /> {label}</label>
      <p className="room-help">{help}</p>
    </>
  );
}

export function RoomSocial({ api, workspaceId, base, settings, on, screens, saved, save, tell, lines, asks, onChanged }: {
  api: Api; workspaceId: string;
  /** Every line a guest could pick, hidden or not. */
  lines: { id: string; words: string }[];
  /** The room's waiting requests, for the dedications on them. */
  asks: RoomAsk[];
  /** Read the room again after a dedication was cleared. */
  onChanged: () => void;
  /** `/rooms/{id}` for this room. */
  base: string;
  settings: SocialSettings;
  /** Which of the five are on for this account. */
  on: SocialOn;
  /** How many big screens are paired, showing or not. */
  screens: number;
  saved: SocialGroup | null;
  save: (change: Partial<SocialSettings>, group: SocialGroup) => void;
  tell: (words: string, problem?: boolean) => void;
}) {
  const [open, setOpen] = useState<Round | null>(null);
  // seconds left, counted down here between reads so the host sees the same clock as the phones
  const [left, setLeft] = useState(0);
  const ends = useRef(0);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const look = async () => {
    const pulse = await api<Pulse>(`${base}/pulse`, {}, workspaceId);
    const round = pulse.round && pulse.round.state === 'open' ? pulse.round : null;
    if (live.current) {
      ends.current = round ? Date.now() + Math.max(0, round.closes_at - pulse.now) * 1000 : 0;
      setOpen(round);
      setLeft(round ? Math.ceil(Math.max(0, round.closes_at - pulse.now)) : 0);
    }
    return round;
  };
  // the button says what is true: a vote the timer or another device started shows here too
  useEffect(() => {
    if (!on.rounds || !settings.rounds) return undefined;
    void look().catch(() => undefined);
    // a vote in progress is read as often as the phones read it, so the counts here keep up
    const timer = window.setInterval(() => void look().catch(() => undefined), open ? 2000 : 5000);
    return () => window.clearInterval(timer);
  }, [base, on.rounds, settings.rounds, Boolean(open)]);
  useEffect(() => {
    if (!open) return undefined;
    const tick = window.setInterval(() => setLeft(Math.ceil(Math.max(0, ends.current - Date.now()) / 1000)), 1000);
    return () => window.clearInterval(tick);
  }, [Boolean(open)]);

  const start = async () => {
    try {
      await api(`${base}/rounds`, { method: 'POST', body: JSON.stringify({}) }, workspaceId);
    } catch (problem) { tell((problem as Error).message || 'Couldn’t start a vote. Try again.', true); return; }
    // The device that is playing offers the songs. It answers within a few seconds or not at all.
    const until = Date.now() + ANSWER_MS;
    while (live.current && Date.now() < until) {
      await new Promise((done) => window.setTimeout(done, 700));
      if (await look().catch(() => null)) { tell('The room is voting for the next song.'); return; }
    }
    if (live.current) tell('The device playing the music didn’t answer, so no vote started. Check it is open with a mix loaded.', true);
  };
  const cancel = async () => {
    if (!open) return;
    try {
      await api(`${base}/rounds/${encodeURIComponent(open.round_id)}/cancel`, { method: 'POST' }, workspaceId);
      setOpen(null);
      tell('Vote called off.');
    } catch (problem) { tell((problem as Error).message || 'Couldn’t call off the vote.', true); }
  };

  const dedicated = asks.filter((ask) => ask.dedication);
  const clear = async (requestId: string) => {
    try {
      await api(`${base}/requests/${encodeURIComponent(requestId)}/dedication`, { method: 'DELETE' }, workspaceId);
      tell('Dedication cleared. The request stays.');
      onChanged();
    } catch (problem) { tell((problem as Error).message || 'Couldn’t clear it. Try again.', true); }
  };
  const together = on.keeps || on.reactions || on.dedications || on.recap;
  const onScreen = screens > 0 && ((on.rounds && settings.rounds) || (on.reactions && settings.reactions) || (on.dedications && settings.dedications) || (on.recap && settings.recap));
  return (
    <>
      {together && (
        <SettingsSection title="Together" saved={saved === 'together'}>
          {on.keeps && <Check label="Guests can keep songs" help="A heart saves the playing song on the guest’s own phone." checked={settings.keeps} change={(keeps) => save({ keeps }, 'together')} />}
          {on.reactions && <Check label="Guests can react" help="Guests love a song or the blend into it. The room sees counts, never who tapped." checked={settings.reactions} change={(reactions) => save({ reactions }, 'together')} />}
          {on.dedications && <Check label="Dedications" help="A guest can add one line from a fixed list to their request, such as Happy birthday." checked={settings.dedications} change={(dedications) => save({ dedications }, 'together')} />}
          {on.dedications && settings.dedications && lines.length > 0 && (
            <fieldset className="room-lines">
              <legend className="room-help">Lines guests can pick. Untick one to hide it.</legend>
              {lines.map((line) => {
                const hidden = settings.dedications_hidden.includes(line.id);
                return (
                  <label className="room-check" key={line.id}>
                    <input type="checkbox" checked={!hidden} onChange={(event) => save({ dedications_hidden: event.target.checked ? settings.dedications_hidden.filter((id) => id !== line.id) : [...settings.dedications_hidden, line.id] }, 'together')} /> {line.words}
                  </label>
                );
              })}
            </fieldset>
          )}
          {on.dedications && dedicated.map((ask) => (
            <div className="room-setting-row" key={ask.request_id}>
              <span><b>{ask.dedication}</b><span className="room-help">On {ask.song?.title ?? 'a song'}{ask.nickname ? `, from ${ask.nickname}` : ''}</span></span>
              <Action type="button" className="quiet" run={() => clear(ask.request_id)} working="Clearing…" aria-label={`Clear the dedication on ${ask.song?.title ?? 'that song'}`}>Clear</Action>
            </div>
          ))}
          {on.recap && <Check label="Tonight in numbers" help="When the room ends, you and your guests see its totals." checked={settings.recap} change={(recap) => save({ recap }, 'together')} />}
        </SettingsSection>
      )}
      {on.rounds && (
        <SettingsSection title="Pick the next song" saved={saved === 'rounds'}>
          <Check label="The room can vote for the next song" help="Guests choose between songs that are not in the mix. The winner plays after the current song." checked={settings.rounds} change={(rounds) => save({ rounds }, 'rounds')} />
          {settings.rounds && (
            <>
              <div className="room-setting-row">
                <span><b>{open ? 'The room is voting' : 'Start a vote now'}</b><span className="room-help">{open ? `Guests are choosing on their phones. ${left} ${left === 1 ? 'second' : 'seconds'} left.` : 'The device playing the music offers the songs.'}</span></span>
                {open
                  ? <Action type="button" className="quiet" run={cancel} working="Calling off…">Call off the vote</Action>
                  : <Action type="button" run={start} working="Starting…">Let the room pick</Action>}
              </div>
              {open && (
                <ul className="room-round" aria-label="The vote so far">
                  {open.options.map((option) => (
                    <li key={option.song_id}>
                      <span><b>{option.song?.title ?? 'A song'}</b><span className="room-help">{option.song?.artist ?? ''}</span></span>
                      <span className="room-round-count">{option.votes} {option.votes === 1 ? 'vote' : 'votes'}</span>
                      <span className="room-round-bar" aria-hidden="true"><i style={{ width: `${open.total ? Math.round((option.votes / open.total) * 100) : 0}%` }} /></span>
                    </li>
                  ))}
                </ul>
              )}
              <Field label="A vote by itself" help={settings.round_every_songs ? `A vote starts every ${settings.round_every_songs} songs while guests are here.` : 'Votes start only when you press the button.'}>
                {(field) => (
                  <select {...field} value={settings.round_every_songs} onChange={(event) => save({ round_every_songs: Number(event.target.value) }, 'rounds')}>
                    {EVERY.map((songs) => <option key={songs} value={songs}>{songs ? `Every ${songs} songs` : 'Only when I start one'}</option>)}
                  </select>
                )}
              </Field>
              <NumberField label="Voting time, in seconds" help="How long guests have to choose." value={settings.round_seconds} min={30} max={120} onSave={(round_seconds) => save({ round_seconds }, 'rounds')} />
              <Check label="Play the winner automatically" help={settings.round_auto_add ? 'The winner goes into the mix without a tap from you.' : 'The winner waits at the top of Requests for you to add.'} checked={settings.round_auto_add} change={(round_auto_add) => save({ round_auto_add }, 'rounds')} />
            </>
          )}
        </SettingsSection>
      )}
      {onScreen && (
        <SettingsSection title="Big screen shows" saved={saved === 'screen'}>
          {on.rounds && settings.rounds && <Check label="The vote" help="The songs, their bars and the time left." checked={settings.screen_rounds} change={(screen_rounds) => save({ screen_rounds }, 'screen')} />}
          {on.reactions && settings.reactions && <Check label="Reactions" help="The room’s hearts under the playing song." checked={settings.screen_reactions} change={(screen_reactions) => save({ screen_reactions }, 'screen')} />}
          {on.dedications && settings.dedications && <Check label="Dedications" help="The line a guest chose, while their song plays." checked={settings.screen_dedications} change={(screen_dedications) => save({ screen_dedications }, 'screen')} />}
          {on.recap && settings.recap && <Check label="Tonight in numbers" help="The room’s totals for ten minutes after it ends." checked={settings.screen_recap} change={(screen_recap) => save({ screen_recap }, 'screen')} />}
        </SettingsSection>
      )}
    </>
  );
}
