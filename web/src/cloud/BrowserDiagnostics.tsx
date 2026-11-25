import { CSSProperties, useCallback, useEffect, useState } from 'react';
import { FLAG_IDS, flagOn } from '../flags';
import { storageSpace, type MediaStore, type StorageSpace } from '../media';
import { ENGINE_VERSION, probeCapability, type ProbeResult } from '../engine/probe';
import { Action, announce, Skeleton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { bytes } from './api';
import { readPersistState, type PersistState } from './persistence';

export type PlaybackFacts = { refusal: string | null; speaker: string | null; phase: string };

/** `problem` stops something working; `note` is worth knowing and stops nothing. */
type Level = 'ok' | 'note' | 'problem';
type Group = 'sound' | 'storage' | 'music';
type Fact = { key: string; group: Group; level: Level; label: string; words: string };
type Gathered = { facts: Fact[]; summary: Record<string, unknown> };

const GROUPS: { id: Group; title: string }[] = [
  { id: 'sound', title: 'Sound' },
  { id: 'storage', title: 'Storage in this browser' },
  { id: 'music', title: 'Music and connection' },
];

async function opfsWorks(): Promise<boolean | null> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage as (StorageManager & { getDirectory?: () => Promise<unknown> }) | undefined;
  if (!storage?.getDirectory) return null;
  try { await storage.getDirectory(); return true; } catch { return false; }
}

async function gather(openStore: () => Promise<MediaStore>, playback: PlaybackFacts, probe: ProbeResult | null): Promise<Gathered> {
  const hasAudio = typeof AudioContext !== 'undefined';
  // `in` on the prototype never calls the accessor, so it cannot throw "Illegal invocation"
  const hasWorklet = hasAudio && 'audioWorklet' in AudioContext.prototype;
  const folderPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const isolated = typeof window !== 'undefined' && window.crossOriginIsolated === true;
  const online = typeof navigator === 'undefined' ? null : navigator.onLine;
  const [space, persist, opfs, index] = await Promise.all([
    storageSpace().catch((): StorageSpace => ({ supported: false, reason: 'The browser would not say.' })),
    readPersistState().catch((): PersistState => 'unsupported'),
    opfsWorks(),
    openStore().then((opened) => ({ opened: true, degraded: opened.degraded })).catch(() => ({ opened: false, degraded: true })),
  ]);
  const off = FLAG_IDS.filter((id) => !flagOn(id));
  const mixes = hasAudio && hasWorklet;
  const kept = index.opened && !index.degraded;
  const facts: Fact[] = [
    { key: 'audio', group: 'sound', level: mixes ? 'ok' : 'problem', label: 'Mixing in this browser', words: mixes ? 'This browser can mix and play your songs.' : hasAudio ? 'This browser is missing a part SelectaDJ mixes with, so it cannot play mixes. A recent desktop browser can.' : 'This browser has no way to play sound for SelectaDJ. A recent desktop browser can.' },
    probe
      ? (probe.ok
        ? { key: 'probe', group: 'sound', level: 'ok', label: 'Audio check', words: `Passed at ${probe.sampleRate} Hz with ${probe.schedulingMisses} ${probe.schedulingMisses === 1 ? 'gap' : 'gaps'} in ${probe.blocks} blocks. This shows audio runs here, not that your speakers are on.` }
        : { key: 'probe', group: 'sound', level: 'problem', label: 'Audio check', words: `Did not pass: ${probe.reason}` })
      : { key: 'probe', group: 'sound', level: 'note', label: 'Audio check', words: 'Not run yet in this visit.' },
    playback.refusal
      ? { key: 'playback', group: 'sound', level: 'problem', label: 'Playing here', words: `Playing here was refused: ${playback.refusal}` }
      : { key: 'playback', group: 'sound', level: 'ok', label: 'Playing here', words: playback.speaker === 'elsewhere' ? 'Another device is the speaker; this browser is controlling it.' : playback.speaker === 'here' ? 'This browser is the speaker.' : 'Nothing is playing right now.' },
    { key: 'index', group: 'storage', level: kept ? 'ok' : 'problem', label: 'Your list of connected songs', words: kept ? 'Kept in this browser between visits.' : 'This browser is not keeping it, so songs need choosing again next visit.' },
    { key: 'persist', group: 'storage', level: persist === 'granted' ? 'ok' : 'note', label: 'Kept safe', words: persist === 'granted' ? 'The browser has agreed to keep SelectaDJ’s details on this device.' : 'The browser may clear SelectaDJ’s details if the device runs short of space. Your music files are never affected.' },
    { key: 'space', group: 'storage', level: space.supported ? 'ok' : 'note', label: 'Space', words: space.supported ? `${bytes(space.usage ?? 0)} used of ${bytes(space.quota ?? 0)} allowed.` : space.reason ?? 'The browser does not say how much storage SelectaDJ may use.' },
    { key: 'opfs', group: 'storage', level: opfs ? 'ok' : 'note', label: 'Private working space', words: opfs ? 'Available.' : opfs === null ? 'Not available in this browser. Some extras, such as stem splitting, need it.' : 'It did not open. Some extras, such as stem splitting, need it.' },
    { key: 'folders', group: 'music', level: folderPicker ? 'ok' : 'note', label: 'Choosing folders', words: folderPicker ? 'Folders can be chosen and remembered here.' : 'This browser cannot remember a folder, so songs are chosen each visit.' },
    { key: 'online', group: 'music', level: online === false ? 'problem' : 'ok', label: 'Connection', words: online === false ? 'This browser says it is offline.' : 'This browser is online.' },
  ];
  const summary = {
    engine: ENGINE_VERSION,
    web_audio: hasAudio,
    audio_worklet: hasWorklet,
    audio_check: probe ? (probe.ok ? { ok: true, sample_rate: probe.sampleRate, scheduling_misses: probe.schedulingMisses, blocks: probe.blocks } : { ok: false, reason: probe.reason }) : 'not run',
    playback: { refused: playback.refusal, speaker: playback.speaker, phase: playback.phase },
    indexeddb: index,
    opfs,
    persistence: persist,
    storage: space.supported ? { usage_mb: Math.round((space.usage ?? 0) / 100_000) / 10, quota_mb: Math.round((space.quota ?? 0) / 1_000_000) } : 'not reported',
    folder_picker: folderPicker,
    cross_origin_isolated: isolated,
    online,
    flags_off: off,
  };
  return { facts, summary };
}

const MARK = { ok: 'check', note: 'dot', problem: 'warning' } as const;
const SAID = { ok: 'Working', note: 'Worth knowing', problem: 'Problem' } as const;

/** What this browser can do for SelectaDJ, measured here: one line that says whether everything
 * works (or the specific problem), the checks grouped and closed until asked for, and a copy for
 * support. The copy holds no names, emails, folder or song names, account or device ids: only
 * capabilities and states. */
export function BrowserDiagnostics({ openStore, playback }: { openStore: () => Promise<MediaStore>; playback: PlaybackFacts }) {
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [gathered, setGathered] = useState<Gathered | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    setGathered(await gather(openStore, playback, probe));
    setCopied(false);
  }, [openStore, playback.refusal, playback.speaker, playback.phase, probe]);
  useEffect(() => { void load(); }, [load]);
  const runCheck = async () => {
    if (typeof AudioContext === 'undefined') {
      setProbe({ ok: false, state: 'unsupported_here', reason: 'This browser has no Web Audio.' });
      return;
    }
    // made inside the press, so the browser lets it start; closed again straight after
    const context = new AudioContext();
    try {
      await context.resume().catch(() => undefined);
      setProbe(await probeCapability(context));
    } catch (problem) {
      setProbe({ ok: false, state: 'unsupported_here', reason: (problem as Error)?.message || 'unknown reason' });
    } finally {
      void context.close().catch(() => undefined);
    }
  };
  if (!gathered) return <section className="ui-card" aria-label="Diagnostics"><Skeleton variant="rows" lines={3} label="Checking this browser" /></section>;
  const text = JSON.stringify(gathered.summary, null, 2);
  const canCopy = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
  const problems = gathered.facts.filter((fact) => fact.level === 'problem');
  const notes = gathered.facts.filter((fact) => fact.level === 'note');
  return (
    <>
      <section className="ui-card lw-health" data-tone={problems.length ? 'problem' : 'done'} aria-labelledby="browser-diagnostics-title">
        <span className="lw-health-mark" aria-hidden="true"><Icon name={problems.length ? 'warning' : 'check'} /></span>
        <div className="lw-health-text" role="status">
          <h2 className="section-title" id="browser-diagnostics-title">{problems.length === 0 ? 'Everything this browser needs is working' : problems.length === 1 ? problems[0].words : `${problems.length} things are not working in this browser`}</h2>
          <p className="hint">
            {problems.length > 1 ? `${problems.map((fact) => fact.label).join(', ')}. ` : ''}
            {notes.length > 0 ? `${notes.length} ${notes.length === 1 ? 'thing is' : 'things are'} worth knowing, below. ` : ''}
            Checked in this browser; nothing is sent anywhere.
          </p>
        </div>
        <div className="lw-health-actions">
          {canCopy && (
            <Action className="primary" run={async () => { await navigator.clipboard.writeText(text); setCopied(true); announce('Details copied.'); }}>
              {copied ? <><Icon name="check" size="toolbar" />Copied</> : 'Copy details for support'}
            </Action>
          )}
          <Action run={runCheck} working="Checking…">{probe ? 'Run the audio check again' : 'Run the audio check'}</Action>
          <Action className="quiet" run={load} working="Checking…">Check again</Action>
        </div>
      </section>
      <div className="lw-groups" data-stagger="">
        {GROUPS.map((group, place) => {
          const facts = gathered.facts.filter((fact) => fact.group === group.id);
          const bad = facts.filter((fact) => fact.level === 'problem').length;
          const noted = facts.filter((fact) => fact.level === 'note').length;
          const working = facts.length - bad - noted;
          return (
            <details key={group.id} className="lw-group" open={bad > 0 || undefined} style={{ '--i': place } as CSSProperties}>
              <summary>
                <span className="lw-group-title">{group.title}</span>
                <span className="lw-group-count" data-level={bad ? 'problem' : noted ? 'note' : 'ok'}>
                  <Icon name={MARK[bad ? 'problem' : noted ? 'note' : 'ok']} size="compact" />
                  {bad ? `${bad} ${bad === 1 ? 'problem' : 'problems'}` : noted ? `${working} of ${facts.length} working` : 'All working'}
                </span>
              </summary>
              <ul className="lw-facts">
                {/* --i lets each line arrive after the one before when the group is opened (feel-account.css) */}
                {facts.map((fact, index) => (
                  <li key={fact.key} data-level={fact.level} style={{ '--i': index } as CSSProperties}>
                    <span className="lw-fact-mark"><Icon name={MARK[fact.level]} size="compact" aria-hidden="true" /><span className="visually-hidden">{SAID[fact.level]}:</span></span>
                    <b>{fact.label}</b>
                    <span>{fact.words}</span>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
        <details className="lw-group diagnostic-raw" style={{ '--i': GROUPS.length } as CSSProperties}>
          <summary><span className="lw-group-title">What the copy for support contains</span></summary>
          <p className="hint">Only what this browser can do and how SelectaDJ is set up in it. No names, emails, songs, folders or account details.</p>
          <pre className="diagnostics" tabIndex={0}>{text}</pre>
        </details>
      </div>
    </>
  );
}
