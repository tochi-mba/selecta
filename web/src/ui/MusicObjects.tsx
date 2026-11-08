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
    <div className={'music-seam-diagram ' + family + (compact ? ' compact' : '') + (made ? ' is-made' : ' is-plan')} data-family={family} role="img" aria-label={meaning}>
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
export function RouteDiagram({ songs, requestedId, state }: {
  songs: { id: number; title: string; artist?: string | null }[];
  requestedId: number;
  state: 'proposed' | 'preparing' | 'ready';
}) {
  if (!songs.length) return null;
  const heading = state === 'proposed' ? 'Proposed route — nothing added' : state === 'ready' ? 'Prepared route — waiting to join' : 'Preparing route — not playable yet';
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
      role="img" aria-label={source === 'measured' ? 'Measured relative energy of the current mix, from start to finish' : 'Draw the requested five-stop energy journey'}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel} onLostPointerCapture={onLostPointerCapture}>
      <polyline className={source === 'measured' ? 'achieved' : undefined} points={points} />
      {source === 'intention' && values.map((energy, index) => (
        <circle key={index} cx={index * 25} cy={38 - energy * 0.34} r="2.2" />
      ))}
    </svg>
  );
}

/** A per-song snapshot, not a generated energy shape or a promised result. Gaps stay unknown.
 * The parent owns the exact mix scope and selection; clicking here cannot edit or play anything. */
export function EnergyOverview({ items, selectedIndex, onSelect }: {
  items: MixItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const measured = items.map((item) => item.energy).filter((energy): energy is number => typeof energy === 'number' && Number.isFinite(energy));
  if (measured.length < 2) {
    return <p className="hint energy-overview-empty">Not enough measured song energy to show a journey yet.</p>;
  }
  const low = Math.min(...measured);
  const high = Math.max(...measured);
  const span = high - low;
  return (
    <section className="energy-overview" aria-label="Measured energy overview">
      <div className="energy-overview-head">
        <strong>Energy through this mix</strong>
        <small>Relative measured song energy only — not your requested shape or a quality score</small>
      </div>
      <ol>
        {items.map((item, index) => {
          const known = typeof item.energy === 'number' && Number.isFinite(item.energy);
          const height = known ? (span === 0 ? 50 : 10 + (item.energy! - low) / span * 90) : 0;
          const level = !known ? 'not measured' : span === 0 ? 'even' : height < 38 ? 'lower' : height > 71 ? 'higher' : 'middle';
          return (
            <li key={item.song_id + '-' + index}>
              <button type="button" aria-current={selectedIndex === index ? 'true' : undefined}
                aria-label={'Select ' + item.title + ', song ' + (index + 1) + ', energy ' + level}
                onClick={() => onSelect(index)}>
                {known
                  ? <span className="energy-overview-bar" style={{ height: height + '%' }} aria-hidden="true" />
                  : <span className="energy-overview-unknown" aria-hidden="true">?</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
