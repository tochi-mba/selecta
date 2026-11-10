import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { MixItem } from '../api';

/** A stable, decorative identity from the real library ID. This is neither album art nor audio analysis. */
export function SongMotif({ songId, large = false }: { songId: number; large?: boolean }) {
  const id = Math.abs(Math.trunc(songId));
  const dots = Array.from({ length: 4 }, (_, i) => ({
    x: 8 + ((id * (i + 3) + i * 13) % 25),
    y: 8 + ((id * (i + 7) + i * 17) % 25),
    radius: 1.5 + ((id + i) % 3),
  }));
  return (
    <svg className={'song-motif' + (large ? ' large' : '')} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="1" opacity=".45" />
      <path d={'M ' + dots.map((point) => point.x + ' ' + point.y).join(' L ')} fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".55" />
      {dots.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={point.radius} fill="currentColor" />)}
    </svg>
  );
}

/** Abstract, deterministic card material for an idea, not cover art, analysis or a
 * prediction of which songs Selecta will select. The group is a visual category only. */
export function VibeMotif({ idea, group }: { idea: string; group: string }) {
  const hash = Array.from(idea).reduce((value, letter) => ((value * 33) ^ letter.charCodeAt(0)) >>> 0, 5381);
  const offset = 4 + (hash % 13);
  // Distinguish ideas within one group too: different keys should not all look
  // like the same preset. These marks encode only the key, never musical facts.
  const marks = Array.from({ length: 5 }, (_, index) => ({
    x: 15 + index * 22,
    y: 9 + ((hash >>> (index * 5)) % 47),
    r: 2 + ((hash >>> (index * 3)) % 4),
  }));
  const family = group === 'The moment' ? 'moment' : group === 'The mood' ? 'mood'
    : group === 'The sound' ? 'sound' : 'journey';
  return (
    <svg className={'vibe-motif ' + family} viewBox="0 0 120 66" preserveAspectRatio="xMidYMid meet"
      aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="118" height="64" rx="11" fill="none" stroke="currentColor" opacity=".3" />
      {marks.map((mark, index) => (
        <circle key={index} cx={mark.x} cy={mark.y} r={mark.r}
          fill={index % 2 === 0 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" opacity=".45" />
      ))}
      {family === 'moment' && <>
        <circle cx={30 + offset} cy="33" r="15" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d={`M${60 + offset} 12 V54 M${80 + offset} 20 V46`} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </>}
      {family === 'mood' && [8, 17, 26].map((radius) => (
        <circle key={radius} cx={59 + offset / 4} cy="33" r={radius} fill="none" stroke="currentColor" strokeWidth="2" />
      ))}
      {family === 'sound' && <>
        {[18, 47, 76].map((x, index) => (
          <rect key={x} x={x + offset / 3} y={13 + index * 5} width="20" height="36" rx="9"
            stroke="currentColor" fill="none" strokeWidth="2" />
        ))}
      </>}
      {family === 'journey' && <>
        <path d={`M14 44 Q${30 + offset} 8 57 29 T105 19`} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="14" cy="44" r="5" fill="currentColor" /><circle cx="105" cy="19" r="5" fill="currentColor" />
      </>}
    </svg>
  );
}

/** Stable mix-specific identity from the returned song order, not a predicted
 * energy curve or waveform. An edit changes the motif only after the actual
 * mix items change; the same mix always draws the same mark. */
export function MixSignature({ items }: { items: Pick<MixItem, 'song_id'>[] }) {
  if (!items.length) return null;
  const seed = items.reduce((state, item, index) => Math.imul(state ^ (item.song_id + index * 101), 16777619) >>> 0, 2166136261);
  const strokes = Array.from({ length: 3 }, (_, row) => {
    let value = (seed ^ Math.imul(row + 1, 2246822519)) >>> 0;
    const y = Array.from({ length: 12 }, () => {
      value = Math.imul(value ^ (value >>> 13), 3266489917) >>> 0;
      return 10 + row * 14 + (value % 13) - 6;
    });
    return y.map((level, index) => (index === 0 ? 'M' : 'L') + (index * (120 / (y.length - 1))).toFixed(1) + ',' + level.toFixed(1)).join(' ');
  });
  return (
    <svg className="mix-signature" viewBox="0 0 120 55" preserveAspectRatio="none"
      aria-hidden="true" focusable="false">
      {strokes.map((path, index) => <path key={index} d={path} fill="none" stroke="currentColor" strokeWidth={2 - index * 0.3} opacity={0.95 - index * 0.22} />)}
    </svg>
  );
}

export type SeamFamily = 'cut' | 'overlap' | 'effect' | 'words' | 'stems' | 'unknown';

/** The type of a *known* musical move, never inferred from its title or from arbitrary analysis. */
export function seamFamily(move: string | null | undefined): SeamFamily {
  if (move === 'cut_on_one') return 'cut';
  if (['bass_swap_blend', 'filter_sweep', 'tempo_ramp'].includes(move ?? '')) return 'overlap';
  if (['echo_out', 'delay_throw', 'reverb_wash'].includes(move ?? '')) return 'effect';
  if (['word_blend', 'word_exchange', 'phrase_roll', 'word_cut'].includes(move ?? '')) return 'words';
  if (['stem_studio', 'stem_arrange', 'stem_intertwine', 'vocal_ride'].includes(move ?? '')) return 'stems';
  return 'unknown';
}

/** One truthful transition diagram used at the song edge and in the Inspector.
 * The chosen move is a plan until an actual rendered style is returned. */
export function SeamDiagram({ seam, from, into, names = {}, compact = false }: {
  seam: NonNullable<MixItem['seam']>;
  from: string;
  into: string;
  names?: Record<string, string>;
  compact?: boolean;
}) {
  const state = seam.state;
  const made = state.status === 'ready';
  const move = made ? state.style : seam.settings.move;
  const family = seamFamily(move);
  const chosenName = names[seam.settings.move ?? 'auto'] ?? (seam.settings.move === 'auto' || !seam.settings.move ? 'Selecta’s choice' : seam.settings.move.replaceAll('_', ' '));
  const displayName = made ? state.label ?? (move ? names[move] ?? move.replaceAll('_', ' ') : 'Transition') : chosenName;
  const status = made ? (seam.too_soon ? 'Rendered; would be missed' : 'Rendered transition') : state.status === 'failed' ? 'Render failed' : state.status === 'rendering' ? 'Rendering' : state.status === 'queued' ? 'Queued to render' : 'Planned, not rendered';
  const fallback = made && (state.fell_back || (seam.settings.move && seam.settings.move !== 'auto' && state.style && state.style !== seam.settings.move));
  const meaning = [status, displayName, 'from ' + from + ' into ' + into, fallback ? 'Different from the requested move' : ''].filter(Boolean).join('. ');
  return (
    <div className={'music-seam-diagram ' + family + (compact ? ' compact' : '') + (made ? ' is-made' : ' is-plan')} data-family={family} data-state={state.status} role="img" aria-label={meaning}>
      <div className="music-seam-lines" aria-hidden="true">
        <i className="outgoing" /><i className="incoming" />
        {family === 'words' && <i className="word-tie" />}
        {family === 'stems' && <i className="stem-tie" />}
        {family === 'effect' && <i className="effect-tail" />}
        {family === 'cut' && <i className="cut-line" />}
      </div>
      <span className="music-seam-label">{status} · {displayName}{fallback ? ' (different move)' : ''}</span>
    </div>
  );
}

/** This route is an actual returned ordering, not a predicted connection or an inserted track.
 * Consent and the eventual atomic join remain with the existing request controller. */
export function RouteDiagram({ songs, requestedId, state, compact = false }: {
  songs: { id: number; title: string; artist?: string | null }[];
  requestedId: number;
  state: 'proposed' | 'preparing' | 'ready';
  compact?: boolean;
}) {
  if (!songs.length) return null;
  const heading = state === 'proposed' ? 'Proposed route - nothing added' : state === 'ready' ? 'Prepared route - waiting to join' : 'Preparing route - not playable yet';
  if (compact) return (
    <div className={'music-route compact ' + state} role="img" aria-label={heading + '. ' + songs.map((song) => song.title).join(' → ')}>
      <span className="music-route-state">{heading}</span>
      <div className="music-route-icons" aria-hidden="true">
        {songs.map((song, index) => (
          <span className={song.id === requestedId ? 'wanted' : 'bridge'} key={song.id + '-' + index}>
            {index > 0 && <span className="music-route-arrow">→</span>}
            <SongMotif songId={song.id} />
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <div className={'music-route ' + state}>
      <p className="music-route-state">{heading}</p>
      <ol aria-label={heading}>
        {songs.map((song, index) => (
          <li key={song.id + '-' + index} className={song.id === requestedId ? 'wanted' : 'bridge'}>
            <SongMotif songId={song.id} />
            <span><b dir="auto">{song.title}</b><small>{song.id === requestedId ? 'Requested song' : 'Extra bridge song'}</small></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Reusable five-stop intention or separately normalized measured energy. These are never
 * superimposed: user intentions and measured relative track energies use different scales. */
export function EnergyHorizon({ values, source, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture }: {
  values: number[];
  source: 'intention' | 'measured';
  onPointerDown?: import('react').PointerEventHandler<SVGSVGElement>;
  onPointerMove?: import('react').PointerEventHandler<SVGSVGElement>;
  onPointerUp?: import('react').PointerEventHandler<SVGSVGElement>;
  onPointerCancel?: import('react').PointerEventHandler<SVGSVGElement>;
  onLostPointerCapture?: import('react').PointerEventHandler<SVGSVGElement>;
}) {
  const safe = values.length === 5 && values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
  if (!safe) return <p className="hint">No complete {source === 'measured' ? 'measured energy' : 'energy intention'} available.</p>;
  const points = values.map((energy, index) => String(index * 25) + ',' + String(38 - energy * 0.34)).join(' ');
  return (
    <svg className={'energy-arc-preview energy-horizon ' + source} viewBox="0 0 100 40" preserveAspectRatio="none"
      role="img" aria-label={source === 'measured' ? 'Measured relative energy of the current mix, from start to finish' : 'Draw energy arc'}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel} onLostPointerCapture={onLostPointerCapture}>
      <polyline className={source === 'measured' ? 'achieved' : undefined} points={points} />
      {source === 'intention' && values.map((energy, index) => (
        <circle key={index} cx={index * 25} cy={38 - energy * 0.34} r="2.2" />
      ))}
    </svg>
  );
}

/** CI-0169-05: a small drawing of how two songs overlap for each transition feel. It illustrates the
 * preference only: it is not a recording, a promise of any one transition, or a measure of how it sounds. */
export function FeelDiagram({ feel }: { feel: string }) {
  const known = feel === 'seamless' || feel === 'punchy' ? feel : 'balanced';
  // outgoing song fades from its own line; the incoming one rises into it. Long overlap for smooth,
  // a near-instant swap for punchy, and both shapes faintly for "each mix chooses".
  const shapes = {
    seamless: [{ out: 'M2 6 L30 6 L58 26', into: 'M30 26 L58 6 L78 6', faint: false }],
    punchy: [{ out: 'M2 6 L42 6 L44 26', into: 'M42 26 L44 6 L78 6', faint: false }],
    balanced: [
      { out: 'M2 6 L30 6 L58 26', into: 'M30 26 L58 6 L78 6', faint: true },
      { out: 'M2 6 L42 6 L44 26', into: 'M42 26 L44 6 L78 6', faint: true },
    ],
  }[known];
  return (
    <svg className={'feel-diagram ' + known} viewBox="0 0 80 32" aria-hidden="true" focusable="false" data-feel={known}>
      {shapes.map((shape, index) => (
        <g key={index} opacity={shape.faint ? 0.55 : 1}>
          <path className="feel-out" d={shape.out} />
          <path className="feel-into" d={shape.into} />
        </g>
      ))}
    </svg>
  );
}

/** CI-0168-04: how long a mix is asked to be, drawn as a share of the longest choice. It scales with
 * the number of songs asked for and never shows minutes, since real length depends on the transitions. */
export function LengthScale({ songs, most }: { songs: number; most: number }) {
  const share = most > 0 && Number.isFinite(songs) ? Math.max(0, Math.min(1, songs / most)) : 0;
  return (
    <span className="length-scale" aria-hidden="true" data-share={share.toFixed(2)}>
      <i style={{ width: `${Math.round(share * 100)}%` }} />
    </span>
  );
}

/** A song's measured energy, or null when there isn't one. Nothing is ever filled in from its neighbours. */
export function measuredEnergy(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** How measured energy moves from song to song, in words. Unknown songs are skipped, never guessed,
 * and a wobble smaller than a quarter of this mix's own range isn't called a change. */
function energyShape(values: number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high - low < 0.05) return 'stays about level';
  const step = Math.max(0.05, (high - low) * 0.25);
  const moves: ('up' | 'down')[] = [];
  let lowest = values[0];
  let highest = values[0];
  let extreme = values[0];
  for (const value of values.slice(1)) {
    const going = moves[moves.length - 1];
    if (!going) {
      lowest = Math.min(lowest, value);
      highest = Math.max(highest, value);
      if (value - lowest >= step) moves.push('up');
      else if (highest - value >= step) moves.push('down');
      extreme = value;
    } else if (going === 'up' ? value > extreme : value < extreme) {
      extreme = value;
    } else if (Math.abs(extreme - value) >= step) {
      moves.push(going === 'up' ? 'down' : 'up');
      extreme = value;
    }
  }
  const rises = moves[0] === 'up';
  if (moves.length === 1) return rises ? 'rises' : 'falls';
  if (moves.length === 2) return rises ? 'rises, then falls' : 'falls, then rises';
  if (moves.length === 3) return rises ? 'rises, falls, then rises again' : 'falls, rises, then falls again';
  return moves.length ? 'rises and falls several times' : 'stays about level';
}

/** One honest sentence about a mix's measured song energy, such as "Measured energy rises, then falls;
 * 2 songs unknown". It describes only the values given, in their order. */
export function energySummary(values: ReadonlyArray<number | null | undefined>): string {
  const known = values.map(measuredEnergy).filter((energy): energy is number => energy !== null);
  const missing = values.length - known.length;
  const unknown = missing ? `; ${missing} ${missing === 1 ? 'song' : 'songs'} unknown` : '';
  if (!values.length) return 'No songs yet';
  if (!known.length) return values.length === 1 ? 'Energy unknown for this song' : `Energy unknown for all ${values.length} songs`;
  if (known.length === 1) return `Measured energy for only one song${unknown}`;
  return `Measured energy ${energyShape(known)}${unknown}`;
}

/** A per-song snapshot, not a generated energy shape or a promised result. Gaps stay unknown.
 * The parent owns the exact mix scope and selection; choosing a song here selects it and nothing else:
 * it cannot edit or play anything. One tab stop, with the arrow keys moving between songs. */
export function EnergyOverview({ items, selectedIndex, onSelect, playingIndex = -1 }: {
  items: MixItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** The song the player is on, only when the parent already knows it for this same mix. */
  playingIndex?: number;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => setCursor(null), [selectedIndex]);
  const anchor = selectedIndex >= 0 ? selectedIndex : playingIndex;
  useEffect(() => {
    // A long mix scrolls sideways here. Keep its selected (or playing) song in view without moving the page.
    const strip = list.current;
    const segment = anchor >= 0 ? strip?.children[anchor] : null;
    if (!strip || !segment || strip.scrollWidth <= strip.clientWidth) return;
    const outer = strip.getBoundingClientRect();
    const inner = segment.getBoundingClientRect();
    if (inner.left < outer.left) strip.scrollLeft += inner.left - outer.left - 8;
    else if (inner.right > outer.right) strip.scrollLeft += inner.right - outer.right + 8;
  }, [anchor, items.length]);
  const energies = items.map((item) => measuredEnergy(item.energy));
  const measured = energies.filter((energy): energy is number => energy !== null);
  if (measured.length < 2) {
    return <p className="hint energy-overview-empty">Not enough measured song energy to show a journey yet.</p>;
  }
  const low = Math.min(...measured);
  const high = Math.max(...measured);
  const span = high - low;
  const describe = (index: number) => {
    const energy = energies[index];
    const height = energy === null ? 0 : span === 0 ? 50 : 10 + (energy - low) / span * 90;
    const level = energy === null ? 'not measured' : span === 0 ? 'even' : height < 38 ? 'lower' : height > 71 ? 'higher' : 'middle';
    return { energy, height, words: items[index].title + ', song ' + (index + 1) + ', energy ' + level + (energy === null ? '' : ' (' + energy.toFixed(2) + ')') };
  };
  const last = items.length - 1;
  const stop = Math.min(Math.max(cursor ?? (selectedIndex >= 0 ? selectedIndex : playingIndex >= 0 ? playingIndex : 0), 0), last);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forwards = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backwards = rtl ? 'ArrowRight' : 'ArrowLeft';
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === forwards ? index + 1 : event.key === backwards ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = Math.min(Math.max(next, 0), last);
    setCursor(target);
    list.current?.children[target]?.querySelector<HTMLButtonElement>('button')?.focus();
  };
  const unknown = items.length - measured.length;
  const selected = items[selectedIndex] ? describe(selectedIndex) : null;
  const playing = playingIndex >= 0 && playingIndex !== selectedIndex && items[playingIndex] ? items[playingIndex] : null;
  return (
    <section className="energy-overview" aria-label="Measured energy overview">
      <div className="energy-overview-head">
        <strong>Energy through this mix</strong>
        <small>Relative measured song energy only - not your requested shape or a quality score</small>
      </div>
      <ol ref={list}>
        {items.map((item, index) => {
          const { energy, height, words } = describe(index);
          const isPlaying = playingIndex === index;
          return (
            <li key={item.song_id + '-' + index}>
              <button type="button" tabIndex={index === stop ? 0 : -1}
                aria-current={selectedIndex === index ? 'true' : undefined}
                aria-label={'Select ' + words + (isPlaying ? ', playing now' : '')}
                title={words + (isPlaying ? ', playing now' : '')}
                onClick={() => { setCursor(index); onSelect(index); }}
                onKeyDown={(event) => move(event, index)}>
                {energy !== null
                  ? <span className="energy-overview-bar" style={{ height: height + '%' }} aria-hidden="true" />
                  : <span className="energy-overview-unknown" aria-hidden="true">?</span>}
                {isPlaying && <span className="energy-overview-playing" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="energy-overview-now">
        {selected ? <>Selected: <span dir="auto">{selected.words}</span>.</> : 'Choose a bar, or use the arrow keys, to select a song.'}
        {playing && <> Playing now: <span dir="auto">{playing.title}</span>, song {playingIndex + 1}.</>}
      </p>
      <p className="energy-overview-summary">
        <span>{energySummary(energies)}.</span>
        {unknown > 0 && <span className="energy-overview-key"><span className="energy-overview-swatch" aria-hidden="true" /> Hatched with “?”: energy not measured</span>}
      </p>
    </section>
  );
}

/** A small picture of measured song energy for a mix card. It can't be pressed, and it says in words
 * what it shows, worked out from the same values. Unknown songs are gaps, never guesses. */
export function EnergyThumb({ values, className = '' }: { values: ReadonlyArray<number | null | undefined>; className?: string }) {
  if (!values.length) return null;
  const energies = values.map(measuredEnergy);
  const measured = energies.filter((energy): energy is number => energy !== null);
  const low = measured.length ? Math.min(...measured) : 0;
  const span = measured.length ? Math.max(...measured) - low : 0;
  const summary = energySummary(values);
  return (
    <span className={'energy-thumb' + (className ? ' ' + className : '')} role="img" aria-label={summary} title={summary}>
      {energies.map((energy, index) => energy === null
        ? <span key={index} className="energy-thumb-unknown" />
        : <span key={index} className="energy-thumb-bar" style={{ height: (span === 0 ? 50 : 15 + (energy - low) / span * 85) + '%' }} />)}
    </span>
  );
}
