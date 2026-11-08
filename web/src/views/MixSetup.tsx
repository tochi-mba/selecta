import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { get, MixItem, post, SongRow, Status } from '../api';
import { Action, Dialog, Problem } from '../ui/controls';
import { EnergyHorizon } from '../ui/MusicObjects';
import { ViewProps } from './shared';

const ARC_STOPS = ['Start', 'Early', 'Middle', 'Late', 'Finish'];
const DEFAULT_ARC = [62, 72, 100, 85, 68];
const ARC_PRESETS = [
  { label: 'Build to a peak', values: [35, 50, 65, 85, 100] },
  { label: 'Peak then settle', values: [45, 75, 100, 70, 40] },
  { label: 'Even energy', values: [72, 75, 75, 75, 72] },
] as const;

const FEEL_WORDS: Record<string, string> = { balanced: 'Each mix chooses its feel', seamless: 'Smooth blends', punchy: 'Punchy changes' };
const STEM_WORDS: Record<string, string> = { never: 'no stem moves', sometimes: 'stem moves sometimes', often: 'stem moves often' };

/** How the next mix will get built, in one line, so it can be seen without opening anything. */
export function buildSummary(steering: Status['steering']): string {
  const parts = [
    FEEL_WORDS[steering.mix_language] ?? steering.mix_language,
    STEM_WORDS[steering.stems] ?? steering.stems,
    steering.energy_arc ? 'your energy shape' : 'each mix’s own energy',
    steering.target ? `ending on ${steering.target_label ?? 'your chosen song'}` : 'Selecta chooses the ending',
  ];
  return parts.join(' · ');
}

/** The energy each song in a mix actually has, on that mix's own scale, from its quietest song to its
 * most energetic. It's a different scale from the shape someone asks for, so the two are never drawn
 * on one chart as if they could be compared number for number. */
function achievedArc(mix: MixItem[]): number[] | null {
  const known = mix.map((item) => item.energy).filter((energy): energy is number => typeof energy === 'number');
  // A gap is unknown, not a quieter song or an invitation to interpolate across it.
  if (mix.length < 2 || known.length !== mix.length) return null;
  const low = Math.min(...known);
  const high = Math.max(...known);
  const span = high - low || 1;
  return ARC_STOPS.map((_, index) => {
    const at = Math.round((index / (ARC_STOPS.length - 1)) * (known.length - 1));
    return Math.round(((known[at] - low) / span) * 100);
  });
}

/** How the next mix gets built. It stays out of the way until someone wants it. */
export function MixSetup({ status, mix, refreshStatus, notify, onClose }: Pick<ViewProps, 'status' | 'mix' | 'refreshStatus' | 'notify'> & { onClose: () => void }) {
  const [problem, setProblem] = useState('');
  const [mixLanguage, setMixLanguage] = useState(status.steering.mix_language);
  const [stemFrequency, setStemFrequency] = useState(status.steering.stems);
  const [energyArc, setEnergyArc] = useState<number[] | null>(status.steering.energy_arc);
  const [arcSaving, setArcSaving] = useState(false);
  const [arcAttempt, setArcAttempt] = useState(0);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinationResults, setDestinationResults] = useState<SongRow[]>([]);
  const [activeDestination, setActiveDestination] = useState(-1);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [destinationFailed, setDestinationFailed] = useState(false);
  const [destinationAttempt, setDestinationAttempt] = useState(0);
  const [destination, setDestination] = useState<{ id: string; label: string } | null>(
    status.steering.target
      ? { id: status.steering.target, label: status.steering.target_label ?? `Song ${status.steering.target}` }
      : null,
  );
  // only the last thing moved gets saved, and an answer to an older save can't move it back
  const arcSaves = useRef(0);
  const drawing = useRef<{ id: number; previous: number[] | null } | null>(null);
  const arcWrites = useRef(0);
  const savedArc = useRef(JSON.stringify(status.steering.energy_arc));
  const steerQueue = useRef<Promise<void>>(Promise.resolve());
  const languageVersion = useRef(0);
  const languageConfirmed = useRef(status.steering.mix_language);
  const stemsVersion = useRef(0);
  const stemsConfirmed = useRef(status.steering.stems);
  const destinationVersion = useRef(0);
  const destinationConfirmed = useRef(destination);

  // The server accepts one steering write at a time. Sending them in order means an
  // older slow reply cannot overwrite the last choice, including when the user revises
  // the same setting before the first request finishes.
  const enqueueSteer = (action: string, value: string | number[] | null): Promise<void> => {
    const work = steerQueue.current.then(async () => {
      await post('/steer', { action, value });
    });
    steerQueue.current = work.catch(() => {});
    return work;
  };
  useEffect(() => {
    const snapshot = JSON.stringify(energyArc);
    const mine = ++arcSaves.current;
    // Reverting to the previously saved value still needs a write if another,
    // now-obsolete write is already in flight.
    if (snapshot === savedArc.current && arcWrites.current === 0) {
      setArcSaving(false);
      return;
    }
    setArcSaving(true);
    const timer = window.setTimeout(() => {
      arcWrites.current += 1;
      void enqueueSteer('energy_arc', energyArc)
        .then(() => {
          savedArc.current = snapshot;
          if (mine !== arcSaves.current) return;
          setArcSaving(false);
          setProblem('');
          refreshStatus();
        })
        .catch((error: Error) => {
          if (mine !== arcSaves.current) return;
          setArcSaving(false);
          setProblem(error.message);
        })
        .finally(() => { arcWrites.current -= 1; });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [energyArc, refreshStatus, arcAttempt]);

  useEffect(() => {
    const query = destinationQuery.trim();
    if (query.length < 2) {
      setDestinationResults([]);
      setDestinationLoading(false);
      setDestinationFailed(false);
      return;
    }
    let live = true;
    setDestinationLoading(true);
    setActiveDestination(-1);
    setDestinationFailed(false);
    setDestinationResults([]);
    const timer = window.setTimeout(() => {
      get<SongRow[]>(`/songs?q=${encodeURIComponent(query)}&state=ready&limit=20`)
        .then((rows) => {
          if (live) setDestinationResults(rows.filter((row) => !row.never && ['synced', 'instrumental'].includes(row.lyric_status ?? '')));
        })
        .catch(() => { if (live) setDestinationFailed(true); }).finally(() => { if (live) setDestinationLoading(false); });
    }, 120);
    return () => { live = false; window.clearTimeout(timer); };
  }, [destinationQuery, destinationAttempt]);

  const chooseMixLanguage = async (value: string) => {
    const mine = ++languageVersion.current;
    setMixLanguage(value);
    try {
      await enqueueSteer('mix_language', value);
      languageConfirmed.current = value;
      if (mine === languageVersion.current) {
        setProblem('');
        refreshStatus();
      }
    } catch (error) {
      if (mine === languageVersion.current) {
        setMixLanguage(languageConfirmed.current);
        setProblem((error as Error).message);
      }
    }
  };
  const chooseStemFrequency = async (value: string) => {
    const mine = ++stemsVersion.current;
    setStemFrequency(value);
    try {
      await enqueueSteer('stems', value);
      stemsConfirmed.current = value;
      if (mine === stemsVersion.current) {
        setProblem('');
        refreshStatus();
      }
    } catch (error) {
      if (mine === stemsVersion.current) {
        setStemFrequency(stemsConfirmed.current);
        setProblem((error as Error).message);
      }
    }
  };
  const chooseDestination = async (song: SongRow | null) => {
    const mine = ++destinationVersion.current;
    const next = song ? { id: String(song.id), label: `${song.title ?? 'Untitled'} - ${song.artist ?? 'Unknown artist'}` } : null;
    setDestination(next);
    try {
      await enqueueSteer('take_me_to', next?.id ?? '');
      destinationConfirmed.current = next;
      if (mine === destinationVersion.current) {
        setProblem('');
        setDestinationQuery('');
        setDestinationResults([]);
        refreshStatus();
        notify(next ? `Future mixes will try to land on ${next.label}.` : 'Selecta will choose the ending again.');
      }
    } catch (error) {
      if (mine === destinationVersion.current) {
        setDestination(destinationConfirmed.current);
        setProblem((error as Error).message);
      }
    }
  };

  const arcSaved = JSON.stringify(energyArc) === savedArc.current;
  const arcPreview = energyArc ?? DEFAULT_ARC;
  const achieved = achievedArc(mix);
  const updateStop = (index: number, value: number) => {
    const next = [...arcPreview];
    next[index] = Math.round(Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0)));
    setEnergyArc(next);
  };
  const drawArcAt = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / (bounds.width || 1)) * 100;
    const y = ((event.clientY - bounds.top) / (bounds.height || 1)) * 40;
    const stop = Math.round(Math.max(0, Math.min(100, x)) / 25);
    const energy = Math.round(Math.max(0, Math.min(100, (38 - y) / 0.34)));
    updateStop(stop, energy);
  };

  return (
    <Dialog title="Shape the next mix" onClose={onClose} footer={<button className="primary" onClick={onClose}>Done shaping</button>}>
      <p className="eyebrow">Optional shape</p>
      <p className="hint">These stay as your defaults for every new mix you build. They don’t change a mix you’ve already got or anything playing now. You can change any transition song by song later.</p>
      {problem && <p className="warn" role="alert">{problem}</p>}

      <h3 className="setup-group">How transitions feel</h3>
      <section className="mix-steering" aria-label="Mix controls">
        <label htmlFor="mix-language">Transition feel</label>
        <select id="mix-language" value={mixLanguage} onChange={(event) => void chooseMixLanguage(event.target.value)}>
          <option value="balanced">Let each mix choose</option>
          <option value="seamless">Smooth blends</option>
          <option value="punchy">Punchy changes</option>
        </select>
      </section>

      <section className="mix-steering" aria-label="Stem transition controls">
        <label htmlFor="stem-frequency">Stem-assisted moves</label>
        <select id="stem-frequency" value={stemFrequency} onChange={(event) => void chooseStemFrequency(event.target.value)}>
          <option value="never">Never</option>
          <option value="sometimes">Sometimes</option>
          <option value="often">Often</option>
        </select>
        <p className="hint">Vocal rides and word hand-offs. They’re only used where the pair fits and the render passes its checks.</p>
      </section>

      <h3 className="setup-group">Where the mix goes</h3>
      <section className="energy-arc" aria-label="Energy arc controls">
        <div className="energy-arc-heading">
          <div>
            <span className="energy-arc-title">Energy arc</span>
            <p className="hint">Draw the shape you’d like, or set each stop below. Selecta aims for it as closely as your songs allow.</p>
          </div>
          <button type="button" onClick={() => setEnergyArc(null)} disabled={energyArc === null}>Use each mix’s arc</button>
        </div>
        <div className="chips energy-presets" role="group" aria-label="Ready-made energy shapes">
          {ARC_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-pressed={JSON.stringify(energyArc) === JSON.stringify(preset.values)}
              onClick={() => setEnergyArc([...preset.values])}
            >{preset.label}</button>
          ))}
        </div>
        <EnergyHorizon
          values={arcPreview}
          source="intention"
          onPointerDown={(event) => {
            // Ignore explicitly secondary pointers; legacy/synthetic pointer events
            // may omit isPrimary or button, but still provide usable coordinates.
            if (event.isPrimary === false || event.button > 0 || drawing.current) return;
            drawing.current = { id: event.pointerId, previous: energyArc ? [...energyArc] : null };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            drawArcAt(event);
          }}
          onPointerMove={(event) => {
            if (drawing.current?.id === event.pointerId && (event.buttons & 1)) drawArcAt(event);
          }}
          onPointerUp={(event) => {
            if (drawing.current?.id !== event.pointerId) return;
            drawArcAt(event);
            drawing.current = null;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            if (drawing.current?.id !== event.pointerId) return;
            setEnergyArc(drawing.current.previous);
            drawing.current = null;
          }}
          onLostPointerCapture={(event) => {
            if (drawing.current?.id !== event.pointerId) return;
            setEnergyArc(drawing.current.previous);
            drawing.current = null;
          }}
        />
        <p className="hint" role="status">
          {arcSaving ? 'Saving your shape…'
            : !arcSaved ? 'Your change was not saved. Try again; the previous setting is still on the server.'
              : energyArc === null ? 'Each mix uses its own shape.' : 'This is the shape you asked for, saved.'}
        </p>
        {!arcSaved && !arcSaving && <button type="button" onClick={() => setArcAttempt((value) => value + 1)}>Try saving the shape again</button>}
        <div className="energy-arc-stops">
          {ARC_STOPS.map((stop, index) => (
            <label key={stop}>
              <span>{stop}</span>
              <input
                aria-label={`Energy arc ${stop.toLowerCase()}`}
                aria-valuetext={`${arcPreview[index]} out of 100`}
                type="range"
                min="0"
                max="100"
                value={arcPreview[index]}
                onChange={(event) => updateStop(index, Number(event.target.value))}
              />
              <input
                aria-label={`Energy arc ${stop.toLowerCase()} numeric value`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                value={arcPreview[index]}
                onChange={(event) => updateStop(index, Number(event.target.value))}
              />
            </label>
          ))}
        </div>
        {achieved && <figure className="achieved-arc">
          <figcaption className="energy-arc-title">What your current mix measured</figcaption>
          <EnergyHorizon values={achieved} source="measured" />
          <p className="hint">Current mix: relative energy from its quietest to its most energetic song. This uses this mix’s own range, so it is not a score against your requested arc.</p>
        </figure>}
      </section>

      <section className="destination-control" aria-label="Mix destination">
        <label htmlFor="destination-search">Take me to</label>
        <input
          id="destination-search"
          type="search"
          value={destinationQuery}
          role="combobox"
          aria-autocomplete="list"
          aria-controls="destination-results"
          aria-expanded={destinationQuery.trim().length >= 2}
          aria-activedescendant={activeDestination >= 0 && destinationResults[activeDestination] ? `destination-option-${destinationResults[activeDestination].id}` : undefined}
          onChange={(event) => { setDestinationQuery(event.target.value); setActiveDestination(-1); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && destinationQuery) {
              event.preventDefault();
              event.stopPropagation();
              setDestinationQuery('');
              setActiveDestination(-1);
            } else if (destinationResults.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              setActiveDestination((before) => (before + (event.key === 'ArrowDown' ? 1 : -1) + destinationResults.length) % destinationResults.length);
            } else if (event.key === 'Enter' && activeDestination >= 0 && destinationResults[activeDestination]) {
              event.preventDefault();
              void chooseDestination(destinationResults[activeDestination]);
            }
          }}
          placeholder="Search a mix-ready song"
          autoComplete="off"
        />
        {destination && (
          <div className="row wrap destination-selected">
            <span>Mixes will try to finish on <b>{destination.label}</b></span>
            <Action run={() => chooseDestination(null)}>Clear destination</Action>
          </div>
        )}
        {destinationQuery.trim().length >= 2 && (
          <ul id="destination-results" className="destination-results" role="listbox" aria-label="Destination songs">
            {destinationResults.map((song, index) => {
              const duplicate = destinationResults.some((other) => other.id !== song.id && other.title === song.title && other.artist === song.artist);
              return (
                <li key={song.id} id={`destination-option-${song.id}`} role="option" aria-selected={index === activeDestination}>
                  <Action run={() => chooseDestination(song)}>
                    {song.title ?? 'Untitled'} - {song.artist ?? 'Unknown artist'}{duplicate ? ` (song ${song.id})` : ''}
                  </Action>
                </li>
              );
            })}
            {destinationLoading && <li role="status" className="hint">Searching ready songs…</li>}
            {destinationFailed && <li><Problem retry={() => setDestinationAttempt((value) => value + 1)}>Couldn’t search ready songs.</Problem></li>}
            {!destinationLoading && !destinationFailed && !destinationResults.length && <li className="hint">No ready songs match yet.</li>}
          </ul>
        )}
        <p className="hint">If there’s no good way there from the rest of the mix, it finishes as near as it can. Clear it to let each mix decide.</p>
      </section>
    </Dialog>
  );
}
