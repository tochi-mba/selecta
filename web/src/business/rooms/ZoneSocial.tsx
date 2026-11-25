// What a zone's room does together (ADR-0488), in the venue manager's room settings.
//
// Each line is there only while its feature is on for the organisation, so a feature that is
// off leaves no words behind. "Patron screen" pairs a TV at /display to this zone; the lines
// about what the screen shows exist only once a screen is paired, because every feature works
// on phones alone and a screen only adds a shared view.

import { useState } from 'react';
import { Action } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import { showToast } from '../../ui/toasts';
import type { Zone } from '../types';
import { useLoad } from '../venue/useVenue';
import type { RoomsClient, SocialSettings } from './roomsClient';

const EVERY = [0, 2, 3, 4, 5, 6, 8, 10].map((songs) => ({ value: String(songs), label: songs ? `Every ${songs} songs` : 'Only when staff start one' }));

function Check({ label, checked, off, change }: { label: string; checked: boolean; off: boolean; change: (next: boolean) => void }) {
  return <label className="venue-check"><input type="checkbox" checked={checked} disabled={off} onChange={(event) => change(event.target.checked)} /><span>{label}</span></label>;
}

export function ZoneSocial({ zone, rooms, off }: { zone: Zone; rooms: RoomsClient; off: boolean }) {
  const social = useLoad(() => rooms.social(zone.id), [rooms, zone.id]);
  const [error, setError] = useState('');
  const [round, setRound] = useState<string | null>(null);
  const [pairing, setPairing] = useState('');
  const [recap, setRecap] = useState<string[] | null>(null);
  if (!social.data) return null;
  const { settings, on, screens, lines, display_on: displayOn } = social.data;
  const anything = on.keeps || on.reactions || on.rounds || on.dedications || on.recap;
  if (!anything && !displayOn) return null;
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setError('');
    try { await work(); if (done) showToast(done); } catch (problem) { setError((problem as Error).message || 'That didn’t work. Try again.'); }
  };
  const change = (body: Partial<SocialSettings>) => run(async () => { social.set(await rooms.changeSocial(zone.id, body)); });
  const screenLines = screens.length > 0;
  return <fieldset className="venue-fields" disabled={off}>
    <legend>What guests can do together</legend>
    {on.keeps && <Check label="Guests can keep songs on their own phone" checked={settings.keeps} off={off} change={(keeps) => void change({ keeps })} />}
    {on.reactions && <Check label="Guests can love a song or a blend (the room sees counts, never who)" checked={settings.reactions} off={off} change={(reactions) => void change({ reactions })} />}
    {on.dedications && <Check label="Guests can add a dedication from a fixed list to their request" checked={settings.dedications} off={off} change={(dedications) => void change({ dedications })} />}
    {on.dedications && settings.dedications && <fieldset className="venue-fields" disabled={off}>
      <legend>Lines guests can pick (untick one to hide it)</legend>
      {lines.map((line) => <Check key={line.id} label={line.words} checked={!settings.dedications_hidden.includes(line.id)} off={off}
        change={(shown) => void change({ dedications_hidden: shown ? settings.dedications_hidden.filter((id) => id !== line.id) : [...settings.dedications_hidden, line.id] })} />)}
    </fieldset>}
    {on.recap && <Check label="Tonight in numbers, once the zone has closed" checked={settings.recap} off={off} change={(recap) => void change({ recap })} />}
    {on.rounds && <Check label="The room can vote for the next song, from songs your rules allow" checked={settings.rounds} off={off} change={(next) => void change({ rounds: next })} />}
    {on.rounds && settings.rounds && <>
      <div className="biz-row">
        {round
          ? <Action disabled={off} run={() => run(async () => { await rooms.cancelRound(zone.id, round); setRound(null); }, 'Vote called off')}>Call off the vote</Action>
          : <Action disabled={off} run={() => run(async () => { setRound((await rooms.startRound(zone.id)).round_id); }, `${zone.name} is voting for the next song`)}>Let the room pick</Action>}
      </div>
      <Select label="A vote by itself" value={String(settings.round_every_songs)} disabled={off} options={EVERY} onChange={(songs) => void change({ round_every_songs: Number(songs) })} />
    </>}
    {on.recap && <div className="biz-row">
      <Action disabled={off} run={() => run(async () => setRecap((await rooms.recap(zone.id)).lines))}>Show tonight in numbers</Action>
    </div>}
    {recap && (recap.length > 1 ? <ul aria-label="Tonight in numbers">{recap.slice(1).map((line) => <li key={line}>{line}</li>)}</ul> : <p role="status">Nobody has joined {zone.name} in the last day.</p>)}
    {displayOn && <>
      <p>Patron screen: open /display on a TV in {zone.name}, then type its code here.</p>
      {screens.map((screen) => <div className="biz-row" key={screen.id}>
        <span>{screen.label}: {screen.online ? 'showing now' : 'not showing'}</span>
        <Action disabled={off} run={() => run(async () => { await rooms.unpairScreen(zone.id, screen.id); await social.reload(); }, `${screen.label} disconnected`)}>Disconnect</Action>
      </div>)}
      <div className="biz-row">
        <TextField label="Code on the screen" value={pairing} disabled={off} onChange={(text) => setPairing(text.slice(0, 8))} />
        <Action disabled={off} run={() => run(async () => { await rooms.pairScreen(zone.id, pairing); setPairing(''); await social.reload(); }, 'Screen paired')}>Pair screen</Action>
      </div>
      {screenLines && <>
        {on.rounds && settings.rounds && <Check label="The screen shows the vote" checked={settings.screen_rounds} off={off} change={(screen_rounds) => void change({ screen_rounds })} />}
        {on.reactions && settings.reactions && <Check label="The screen shows reactions" checked={settings.screen_reactions} off={off} change={(screen_reactions) => void change({ screen_reactions })} />}
        {on.dedications && settings.dedications && <Check label="The screen shows dedications" checked={settings.screen_dedications} off={off} change={(screen_dedications) => void change({ screen_dedications })} />}
        {on.recap && settings.recap && <Check label="The screen shows tonight in numbers after closing" checked={settings.screen_recap} off={off} change={(screen_recap) => void change({ screen_recap })} />}
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
