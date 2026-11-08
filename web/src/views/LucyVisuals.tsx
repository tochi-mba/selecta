import { ReactNode } from 'react';
import { length } from '../lib';
import type { Card, Family } from '../lucy/types';
import { countsWords, humanize, keyDistanceWords, plural, tempoGapWords, valueWords } from '../lucy/words';
import { Status } from '../ui/controls';
import { EnergyThumb } from '../ui/MusicObjects';

/** What each kind of step found, drawn small, always with the same thing in words. Every number and
 * name here comes from the step's own result; anything missing is said to be unknown. A kind this
 * page doesn't know gets the plain fallback, so a new step from the server still shows. */

type Visual = Record<string, unknown>;
type Renderer = (props: { visual: Visual; card: Card }) => ReactNode;

const rows = (value: unknown): Visual[] => (Array.isArray(value) ? value.filter((item): item is Visual => !!item && typeof item === 'object') : []);
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const songName = (song: Visual) => str(song.title) || 'Untitled';
const artistName = (song: Visual) => str(song.artist) || 'Unknown artist';

const OPS: Record<string, string> = {
  '=': 'is', '==': 'is', eq: 'is', '!=': 'is not', ne: 'is not', '>': 'over', gt: 'over', '>=': 'at least', gte: 'at least',
  '<': 'under', lt: 'under', '<=': 'at most', lte: 'at most', in: 'is one of', contains: 'includes', between: 'between', not_in: 'is not one of',
};

function SongList({ songs, shown = 6, numbered = false }: { songs: Visual[]; shown?: number; numbered?: boolean }) {
  if (!songs.length) return null;
  const List = numbered ? 'ol' : 'ul';
  return (
    <>
      <List className="lucy-mini-list">
        {songs.slice(0, shown).map((song, index) => (
          <li key={`${str(song.id) || count(song.id) || index}-${index}`}><span dir="auto">{songName(song)}</span> <span className="soft" dir="auto">{artistName(song)}</span></li>
        ))}
      </List>
      {songs.length > shown && <p className="hint">and {plural(songs.length - shown, 'more song')}</p>}
    </>
  );
}

const Search: Renderer = ({ visual }) => {
  const filters = rows(visual.filters);
  const matched = count(visual.matched);
  const returned = count(visual.returned);
  return (
    <>
      {filters.length > 0 && (
        <ul className="lucy-filters" aria-label="What Lucy looked for">
          {filters.map((filter, index) => (
            <li key={index} className="lucy-chip">{humanize(str(filter.field))} {OPS[str(filter.op)] ?? str(filter.op)} {valueWords(filter.value)}</li>
          ))}
        </ul>
      )}
      <p className="lucy-card-line">
        {matched === null ? 'Matches: unknown' : plural(matched, 'match', 'matches')}
        {matched !== null && returned !== null && returned < matched ? `, showing ${returned}` : ''}
        {visual.capped === true ? ' (the list was cut short)' : ''}
      </p>
      <SongList songs={rows(visual.items)} />
    </>
  );
};

const Analysis: Renderer = ({ visual }) => {
  const song = (visual.song && typeof visual.song === 'object' ? visual.song : {}) as Visual;
  const fields = visual.fields && typeof visual.fields === 'object' ? Object.entries(visual.fields as Record<string, Visual>) : [];
  return (
    <>
      {(str(song.title) || str(song.artist)) && <p className="lucy-card-line"><b dir="auto">{songName(song)}</b> <span className="soft" dir="auto">{artistName(song)}</span></p>}
      {fields.length > 0 && (
        <dl className="lucy-facts">
          {fields.map(([name, field]) => (
            <div key={name}>
              <dt>{humanize(name)}</dt>
              <dd>{field?.known ? valueWords(field.value) : 'unknown'}{str(field?.source) && <span className="soft"> · {str(field.source)}</span>}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
};

const EDGE_STATUS: Record<string, { words: string; kind: 'ready' | 'planned' | 'unavailable' | 'warning' }> = {
  ready: { words: 'Ready to play', kind: 'ready' },
  history_only: { words: 'Worked before, not ready now', kind: 'planned' },
  predicted: { words: 'Not tried yet', kind: 'planned' },
  unknown: { words: 'Unknown', kind: 'unavailable' },
};

function Edge({ edge }: { edge: Visual }) {
  const a = (edge.a && typeof edge.a === 'object' ? edge.a : {}) as Visual;
  const b = (edge.b && typeof edge.b === 'object' ? edge.b : {}) as Visual;
  const status = EDGE_STATUS[str(edge.status)] ?? EDGE_STATUS.unknown;
  const warnings = Array.isArray(edge.warnings) ? edge.warnings.filter((item): item is string => typeof item === 'string') : [];
  return (
    <div className="lucy-edge">
      <p className="lucy-edge-pair">
        <span dir="auto">{songName(a)}</span>
        <span aria-hidden="true"> → </span><span className="visually-hidden"> into </span>
        <span dir="auto">{songName(b)}</span>
      </p>
      <p className="lucy-card-line">
        <Status kind={status.kind}>{status.words}</Status>
        {str(edge.requested) && <span> · Planned: {str(edge.requested)}</span>}
        {str(edge.rendered) && <span> · Made as: {str(edge.rendered)}</span>}
      </p>
      <p className="hint">{tempoGapWords(count(edge.tempo_gap))} · {keyDistanceWords(count(edge.key_distance))}</p>
      {warnings.length > 0 && <ul className="lucy-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    </div>
  );
}

const Transition: Renderer = ({ visual }) => {
  if (!Array.isArray(visual.edges)) return <Edge edge={visual} />;
  const edges = rows(visual.edges);
  const total = count(visual.total);
  return (
    <>
      <p className="lucy-card-line">{total === null ? plural(edges.length, 'transition') : `${plural(total, 'transition')}${edges.length < total ? `, showing ${edges.length}` : ''}`}</p>
      {edges.slice(0, 5).map((edge, index) => <Edge key={index} edge={edge} />)}
    </>
  );
};

const Planning: Renderer = ({ visual }) => {
  const songs = rows(visual.songs);
  const total = count(visual.count) ?? songs.length;
  const duration = visual.duration && typeof visual.duration === 'object' ? visual.duration as Visual : null;
  const low = count(duration?.low);
  const high = count(duration?.high);
  return (
    <>
      {songs.length > 0 && <EnergyThumb values={songs.map((song) => count(song.energy))} className="lucy-energy-thumb" />}
      <p className="lucy-card-line">
        {plural(total, 'song')}
        {low !== null && high !== null ? (Math.abs(high - low) < 60 ? `, about ${length(low)}` : `, about ${length(low)}–${length(high)}`) : ', length unknown'}
      </p>
      {visual.ready_only === true && <p className="lucy-chip lucy-ready-only">Only transitions that are already ready</p>}
      <SongList songs={songs} numbered />
    </>
  );
};

const Constraints: Renderer = ({ visual }) => {
  const rules = rows(visual.rules);
  if (!rules.length) return null;
  return (
    <ul className="lucy-rule-list">
      {rules.map((rule, index) => (
        <li key={str(rule.id) || index}>
          <span className="lucy-strength">{rule.strength === 'hard' ? 'Must' : 'Prefer'}</span> <span dir="auto">{str(rule.label) || 'A rule'}</span>{' '}
          {rule.status === 'pass' ? <Status kind="ready">Met</Status> : rule.status === 'block' ? <Status kind="blocked">Not met</Status> : <Status kind="unavailable">Unknown</Status>}
        </li>
      ))}
    </ul>
  );
};

const RevisionVisual: Renderer = ({ visual }) => (
  <p className="lucy-card-line">
    {count(visual.number) !== null ? `Revision ${count(visual.number)}: ` : ''}
    {countsWords(visual.counts as Record<string, number> | undefined) || 'No details'}
  </p>
);

const Render: Renderer = ({ visual }) => {
  const seams = rows(visual.seams);
  const ready = count(visual.ready);
  const needed = count(visual.needed);
  const tally = seams.reduce<Record<string, number>>((all, seam) => ({ ...all, [str(seam.status) || 'unknown']: (all[str(seam.status) || 'unknown'] ?? 0) + 1 }), {});
  return (
    <>
      {seams.length > 0 && (
        <span className="lucy-seam-strip" aria-hidden="true">
          {seams.map((seam, index) => <i key={str(seam.key) || index} className={`is-${str(seam.status) || 'unknown'}`} />)}
        </span>
      )}
      <p className="lucy-card-line">
        {ready !== null && needed !== null ? `${ready} of ${plural(needed, 'transition')} ready` : 'How many are ready: unknown'}
        {Object.keys(tally).length > 0 && ` · ${Object.entries(tally).map(([status, n]) => `${n} ${humanize(status).toLowerCase()}`).join(', ')}`}
      </p>
    </>
  );
};

const Items: Renderer = ({ visual }) => {
  const items = rows(visual.items);
  if (!items.length) return null;
  return (
    <dl className="lucy-facts">
      {items.map((item, index) => (
        <div key={index}><dt dir="auto">{str(item.label) || 'Item'}</dt><dd dir="auto">{valueWords(item.value)}</dd></div>
      ))}
    </dl>
  );
};

/** Anything else: only plain values, by name. Nothing is drawn that the step didn't say. */
const Generic: Renderer = ({ visual }) => {
  const plain = Object.entries(visual).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value));
  if (!plain.length) return null;
  return (
    <dl className="lucy-facts">
      {plain.slice(0, 8).map(([name, value]) => <div key={name}><dt>{humanize(name)}</dt><dd>{valueWords(value)}</dd></div>)}
    </dl>
  );
};

export const VISUALS: Partial<Record<Family, Renderer>> = {
  search: Search,
  analysis: Analysis,
  transition: Transition,
  planning: Planning,
  constraints: Constraints,
  revision: RevisionVisual,
  render: Render,
  memory: Items,
  history: Items,
};

export function CardVisual({ card }: { card: Card }) {
  const Draw = VISUALS[card.family] ?? Generic;
  const visual = card.visual && typeof card.visual === 'object' ? card.visual : {};
  return <div className="lucy-visual"><Draw visual={visual} card={card} /></div>;
}
