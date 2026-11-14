import { useEffect, useMemo, useState } from 'react';
import { BrowserVenueAudio, type LocalRecording, type PlayerSnapshot } from '../../venue-player/browserAudio';
import { recordingAllowed, venueOpen, type VenuePolicy, type Weekday } from '../../venue-player/policy';
import type { Venue } from '../types';

/**
 * Real on-device sound path for a single-tablet venue.
 * A local File is never POSTed. The Cloud session and Agent 02 canonical source
 * binding are separate integration ports; until wired, this is an ON-SITE check,
 * not evidence that remotely scheduled business programmes work.
 */
const weekdays: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const platformHelp = 'Keep this browser visible, the tablet powered and its speaker connected. A PWA, wake lock, Guided Access and Android battery exemptions cannot guarantee background or reboot recovery.';

function policyForVenue(venue: Venue): VenuePolicy {
  return {
    timezone: venue.time_zone,
    revision: 'local-venue-browser-check',
    rightsAttested: Boolean(venue.licence?.attested_at),
    rightsUntilEpochMs: venue.licence?.expires_on ? Date.parse(venue.licence.expires_on + 'T23:59:59Z') : null,
    allowExplicit: false, // fail closed until Agent 09 policy binding confirms content
    blockedArtists: [],
    dayparts: [],
    openings: weekdays.flatMap((day) => (venue.hours?.[day] ?? []).map((span) => ({
      day, startMinute: span.open, endMinute: span.close,
    }))),
  };
}

export function BrowserVenueSetup({ venue, nowEpochMs, authorised = true }: { venue: Venue; nowEpochMs?: number; authorised?: boolean }) {
  const [audio] = useState(() => new BrowserVenueAudio());
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>(() => audio.snapshot());
  const [files, setFiles] = useState<File[]>([]);
  const [rights, setRights] = useState(false);
  const [clean, setClean] = useState(false);
  const [zoneId, setZoneId] = useState(venue.zones[0]?.id ?? '');
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const policy = useMemo(() => policyForVenue(venue), [venue]);
  const now = nowEpochMs ?? Date.now();
  const localDate = (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: venue.time_zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
      const part = (key: string) => parts.find((item) => item.type === key)?.value ?? '';
      return part('year') + '-' + part('month') + '-' + part('day');
    } catch { return ''; }
  })();
  const licenceCurrent = Boolean(venue.licence?.attested_at) && Boolean(venue.licence?.expires_on)
    && venue.licence!.expires_on >= localDate && Boolean(localDate);
  const records = useMemo<LocalRecording[]>(() => files.map((file, index) => ({
    id: 'selected_' + index,
    title: file.name.replace(/\.[^.]+$/, '').slice(0, 100),
    artist: 'Locally selected',
    file,
    permitted: rights && clean,
    revision: file.name + ':' + file.size + ':' + file.lastModified,
  })), [files, rights, clean]);
  useEffect(() => {
    const sync = () => setSnapshot(audio.snapshot());
    const interval = window.setInterval(sync, 1000);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', sync);
      void audio.dispose();
    };
  }, [audio]);

  const doAction = (work: () => Promise<string>) => {
    setBusy(true); setError(''); setMessage('');
    void work().then(setMessage).catch((problem: unknown) => setError(problem instanceof Error ? problem.message : 'Device audio unavailable'))
      .finally(() => { setBusy(false); setSnapshot(audio.snapshot()); });
  };
  const zone = venue.zones.find((candidate) => candidate.id === zoneId);
  const sourceReady = rights && clean && records.length > 0;
  const localWindowOpen = (() => { try { return venueOpen(policy, now); } catch { return false; } })();
  const allowed = authorised && sourceReady && licenceCurrent && policy.rightsAttested && localWindowOpen && zone?.paid === true
    && records.every((rec) => recordingAllowed(policy, {
      id: rec.id, artist: rec.artist, explicit: false, locallyAuthorised: true,
      exactRevisionVerified: true, blocked: false,
    }, now));
  const start = async () => {
    if (!allowed) throw new Error('Opening hours, licensing, verified local music and the chosen zone must all allow playback');
    audio.importLocal(records);
    if (!await audio.unlock()) throw new Error(audio.snapshot().lastError ?? 'Tap Start to unlock sound');
    await audio.prepare(records[0].id);
    await audio.start(records[0].id, snapshot.generation + 1);
    setPosition(0);
    return 'Audio started on this device. Test the real speaker and confirm that you hear it; this is not yet Cloud programme activation.';
  };
  const next = async () => {
    if (!allowed || !records[position + 1]) throw new Error('No next locally permitted song');
    await audio.transition(records[position + 1].id, 1);
    setPosition(position + 1);
    return 'Next recording routed through this tablet. Recheck the physical speaker.';
  };

  return <section className="biz-card br64-venue-setup" aria-labelledby="br64-venue-title" data-testid="br64-08-tablet-setup">
    <h3 id="br64-venue-title">Play locally on this iPad, Android tablet or laptop</h3>
    <p>No desktop, Python installer or second device required for this on-device playback check. This browser plays through its current system audio output. Network speakers are not automatically supported.</p>
    <p className="biz-quiet">{platformHelp}</p>
    <label htmlFor="br64-zone">One physical speaker zone on this device</label>
    <select id="br64-zone" value={zoneId} onChange={(event) => setZoneId(event.target.value)} disabled={busy || snapshot.phase === 'playing'}>
      {venue.zones.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
    </select>
    {venue.zones.length > 1 && <p role="note">Additional zones need separate verified players or independently qualified output routing.</p>}
    <label htmlFor="br64-files">Select music from this device (no upload)</label>
    <input id="br64-files" type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg" multiple
      disabled={busy || snapshot.phase === 'playing'}
      onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setRights(false); setClean(false); setPosition(0); }} />
    <p>{files.length} locally selected file(s). Exact format decoding depends on this browser; mobile memory is limited.</p>
    <label><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />
      I have permission to use these local recordings for this venue, including any required commercial music licences.
    </label>
    <label><input type="checkbox" checked={clean} onChange={(event) => setClean(event.target.checked)} />
      I have personally reviewed the selected recordings for the venue's content restrictions; treat them as clean-only for this check.
    </label>
    {!authorised && <p role="alert">This account cannot start venue audio. Ask an authorised venue manager.</p>}
    {!licenceCurrent && <p role="alert">Venue music licence is missing, expired or unverified in HQ.</p>}
    {!localWindowOpen && <p role="status">Outside configured venue hours. Playback for service is blocked; check the schedule.</p>}
    <div className="biz-row br64-actions">
      <button type="button" disabled={busy || !allowed} onClick={() => doAction(start)}>Tap to start here</button>
      <button type="button" disabled={busy || !authorised || !snapshot.contextRunning} onClick={() => doAction(async () => { await audio.soundCheck(); return 'Listen at the venue speaker, then choose “I heard it”.'; })}>Test speaker</button>
      <button type="button" disabled={busy || !authorised || !snapshot.contextRunning} onClick={() => {
        const heard = audio.confirmHeard(); setSnapshot(audio.snapshot());
        setMessage(heard ? 'Operator confirmed the local speaker test. This is not a continuous hardware meter.' : 'Run a fresh test, then confirm within two minutes.');
      }}>I heard it</button>
    </div>
    <div className="biz-row br64-actions">
      <button type="button" disabled={busy || !authorised || snapshot.phase !== 'playing'} onClick={() => doAction(async () => { await audio.pause(); return 'Paused locally.'; })}>Pause</button>
      <button type="button" disabled={busy || !authorised || snapshot.phase !== 'paused'} onClick={() => doAction(async () => { await audio.resume(); return 'Resumed here; recheck the speaker.'; })}>Resume</button>
      <button type="button" disabled={busy || snapshot.phase !== 'playing' || !records[position + 1]} onClick={() => doAction(next)}>Next</button>
      <button type="button" disabled={busy || !authorised || !['playing', 'paused', 'interrupted'].includes(snapshot.phase)} onClick={() => doAction(async () => { await audio.stop(); return 'Local playback stopped.'; })}>Stop</button>
    </div>
    <label htmlFor="br64-volume">Safe device gain (maximum 75%)</label>
    <input id="br64-volume" type="range" min="0" max="75" defaultValue="45" aria-label="Venue device gain" onChange={(event) => audio.setVolume(Number(event.target.value) / 100)} />
    <p role="status" aria-live="polite">Player: {snapshot.phase}. Speaker test: {snapshot.output === 'operator_checked' ? 'Heard by an operator' : 'Not verified'}.
      {snapshot.foreground ? ' Browser visible.' : ' Browser hidden: playback cannot be trusted.'}
      {snapshot.wakeLockHeld ? ' Wake lock held (not a guarantee).' : ' Wake lock unavailable or not held.'}
      {snapshot.online ? '' : ' Offline: already loaded local music may continue only while this page executes.'}
    </p>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <p className="biz-quiet">This on-site test does not register a Cloud playback session, verify exact catalogue bindings, execute intelligent transitions or accept remote requests. Those require the Agent 01/02/06 session adapters and full policy projection. No “venue ready” evidence is sent by this check.</p>
  </section>;
}
