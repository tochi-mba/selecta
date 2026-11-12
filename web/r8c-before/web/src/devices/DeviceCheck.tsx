import { useMemo, useState } from 'react';
import { browserName, capabilities, currentFacts, deviceKind, speakerWarning, type BrowserFacts } from './deviceInfo';

/** The real-device checklist (ADR-0415 SC-0415-03/04/05, ADR-0399 SC-0399-02), behind the
 * off-by-default `cloud.device_check` flag. It reads what this browser supports, lists the checks a
 * person must do by ear and by hand on this device, and writes a plain record to copy into the
 * checklist. It never decides a check passed: the person ticks each one. */
export const DEVICE_CHECK_FLAG = 'cloud.device_check';

export function showsDeviceCheck(features: Record<string, boolean> | undefined) {
  return features?.[DEVICE_CHECK_FLAG] === true;
}

export type DeviceCheckStep = { id: string; task: string; text: string };

export const DEVICE_CHECK_STEPS: DeviceCheckStep[] = [
  { id: 'transfer', task: 'SC-0415-03', text: 'With a laptop and a phone on this account, press Play here on the other device, including mid-crossfade. Only one plays at any moment.' },
  { id: 'offline', task: 'SC-0415-04', text: 'Make this device the speaker, drop its Wi-Fi for a minute, then reconnect. It keeps playing; if someone pressed Play here meanwhile, it fades out on reconnect.' },
  { id: 'lid', task: 'SC-0415-04', text: 'Close the lid (or lock the screen) after someone else pressed Play here, then reopen. It does not start playing again.' },
  { id: 'guidance', task: 'SC-0415-05', text: 'Ask this device to play here. On an iPhone the screen-on note shows and the screen stays on while it plays; note what happens when it locks.' },
  { id: 'seams', task: 'SC-0399-02', text: 'Play a mix across at least three seams in this browser. Each hand-off sounds tight, with no echo, gap or flam.' },
];

export type CheckFacts = BrowserFacts & { sampleRate?: number; cacheStorage?: boolean };

export function deviceRecord(facts: CheckFacts, results: Record<string, 'pass' | 'fail' | undefined>, notes: string, when: Date) {
  const kind = deviceKind(facts);
  const caps = capabilities(facts);
  const lines = [
    `Device check, ${when.toISOString().slice(0, 10)}: ${browserName(facts)} (${kind})`,
    `User agent: ${facts.userAgent}`,
    `Plays audio: ${caps.can_play_audio ? 'yes' : 'no'}; screen wake lock: ${caps.wake_lock ? 'yes' : 'no'}; iOS: ${caps.ios ? 'yes' : 'no'}; home-screen app: ${caps.ios_home_screen ? 'yes' : 'no'}`,
    `Audio sample rate: ${facts.sampleRate ?? 'unknown'}; offline copies (Cache Storage): ${facts.cacheStorage ? 'yes' : 'no'}`,
    `Speaker note shown here: ${speakerWarning(kind, caps) ?? 'none'}`,
    ...DEVICE_CHECK_STEPS.map((step) => `${step.task} ${step.id}: ${results[step.id] ?? 'not checked'}`),
  ];
  if (notes.trim()) lines.push(`Notes: ${notes.trim()}`);
  return lines.join('\n');
}

function measuredFacts(): CheckFacts {
  const facts: CheckFacts = { ...currentFacts(), cacheStorage: typeof caches !== 'undefined' };
  try {
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Context) { const context = new Context(); facts.sampleRate = context.sampleRate; void context.close(); }
  } catch { /* unknown is fine */ }
  return facts;
}

export function DeviceCheck({ facts, now = () => new Date() }: { facts?: CheckFacts; now?: () => Date }) {
  const measured = useMemo(() => facts ?? measuredFacts(), [facts]);
  const [results, setResults] = useState<Record<string, 'pass' | 'fail' | undefined>>({});
  const [notes, setNotes] = useState('');
  const record = deviceRecord(measured, results, notes, now());
  const mark = (id: string, value: 'pass' | 'fail') => setResults((was) => ({ ...was, [id]: was[id] === value ? undefined : value }));
  return (
    <section className="cloud-card" aria-labelledby="cloud-device-check-title">
      <p className="cloud-eyebrow">DEVICE CHECK</p>
      <h2 id="cloud-device-check-title">Check this device</h2>
      <p>For the checks only a person can do on a real device. Mark each one as you go, then copy the record into the checklist.</p>
      <ol>
        {DEVICE_CHECK_STEPS.map((step) => (
          <li key={step.id}>
            <p>{step.text}</p>
            <div role="group" aria-label={`Result for ${step.task} ${step.id}`}>
              <button aria-pressed={results[step.id] === 'pass'} onClick={() => mark(step.id, 'pass')}>Worked</button>{' '}
              <button aria-pressed={results[step.id] === 'fail'} onClick={() => mark(step.id, 'fail')}>Didn’t work</button>
            </div>
          </li>
        ))}
      </ol>
      <label>Notes <textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <label>Record <textarea readOnly value={record} rows={8} /></label>
      <button onClick={() => void navigator.clipboard?.writeText(record)}>Copy record</button>
    </section>
  );
}
