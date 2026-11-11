import { useId, useState } from 'react';
import type { MixItem } from '../api';
import { clock } from '../lib';
import { Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { flagOn } from '../flags';
import { EnergyOverview, EnergyThumb, MixHorizon } from '../ui/MusicObjects';
import { EDITOR_MODES, EditorMode, EditorSelection, storySeamWords } from './editorMode';

/** Story, Arrange or Detail. Ordinary radio buttons, so there's one tab stop and the arrow keys move
 * between them. Choosing one only changes how the same mix is shown. */
export function ViewSwitch({ mode, onChange }: { mode: EditorMode; onChange: (next: EditorMode) => void }) {
  const name = useId();
  const about = useId();
  return (
    <fieldset className="view-switch" aria-describedby={about}>
      <legend>View</legend>
      <div className="view-switch-options">
        {EDITOR_MODES.map((option) => (
          <label className="view-switch-option" key={option.id}>
            <input type="radio" name={name} value={option.id} checked={mode === option.id} onChange={() => onChange(option.id)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <p className="hint view-switch-about" id={about}>{EDITOR_MODES.find((option) => option.id === mode)?.about}</p>
    </fieldset>
  );
}

const ENERGY_OPEN_KEY = 'selecta.energyOverview';
/** A short mix is easy to read without it, so it starts folded away; a long one starts open. */
const ENERGY_OPEN_FROM = 12;

function savedEnergyOpen(): boolean | null {
  try {
    const saved = window.localStorage.getItem(ENERGY_OPEN_KEY);
    return saved === 'open' ? true : saved === 'closed' ? false : null;
  } catch {
    return null;
  }
}

/** The energy overview above the Arrange timeline, folded away until it's wanted. Whether it's open is
 * remembered in this browser only. */
export function EnergyDisclosure(props: { items: MixItem[]; selectedIndex: number; playingIndex: number; onSelect: (index: number) => void }) {
  const { items } = props;
  const [open, setOpen] = useState(() => savedEnergyOpen() ?? items.length >= ENERGY_OPEN_FROM);
  const panel = useId();
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem(ENERGY_OPEN_KEY, next ? 'open' : 'closed'); } catch { /* it stays as chosen until the page reloads */ }
  };
  return (
    <div className="energy-disclosure">
      <div className="energy-disclosure-bar">
        <button type="button" className="energy-disclosure-toggle" aria-expanded={open} aria-controls={panel} onClick={toggle}>
          <Icon name={open ? 'up' : 'down'} size="toolbar" /> Measured song energy
        </button>
        {!open && <EnergyThumb values={items.map((item) => item.energy)} />}
      </div>
      <div id={panel} hidden={!open}>
        {open && <EnergyOverview {...props} />}
      </div>
    </div>
  );
}

/** The mix as a journey, for anyone: each song as a numbered chapter and each transition in plain words,
 * from what the server says is there. There are no editing controls here. Edit opens Detail on exactly
 * that song or transition. */
export function EditorStory(props: {
  mix: MixItem[];
  keys: string[];
  names: Record<string, string>;
  selected: EditorSelection | null;
  playingIndex: number;
  headingId: string;
  onSelectSong: (index: number) => void;
  onEditSong: (key: string) => void;
  onEditSeam: (a: string, b: string) => void;
  /** CI-0169-01: whose songs the start-to-finish horizon is measured from */
  scope?: 'current' | 'draft';
}) {
  const { mix, keys, names, selected, playingIndex, headingId, onSelectSong, onEditSong, onEditSeam } = props;
  const selectedSongIndex = selected?.kind === 'song' ? keys.indexOf(selected.key) : -1;
  return (
    <section className={`editor-story ${mix.length > 40 ? 'long' : ''}`} aria-labelledby={headingId}>
      <h2 id={headingId} className="editor-story-title" tabIndex={-1} data-mode-heading="story">Song by song</h2>
      <p className="hint">Each song in order, and how it leads into the next. To change something, choose Edit.</p>
      {mix.length > 1 && flagOn('editor.energy_horizon') && <MixHorizon items={mix} scope={props.scope ?? 'current'} />}
      {mix.length > 1 && <EnergyOverview items={mix} selectedIndex={selectedSongIndex} playingIndex={playingIndex} onSelect={onSelectSong} />}
      <ol className="story-chapters">
        {mix.map((item, index) => {
          const key = keys[index];
          const previous = mix[index - 1];
          const songSelected = selected?.kind === 'song' && selected.key === key;
          const seamSelected = !!previous && selected?.kind === 'seam' && selected.a === keys[index - 1] && selected.b === key;
          const words = previous ? storySeamWords(item.seam, names, previous.title) : null;
          const playing = playingIndex === index;
          return (
            <li className="story-chapter" key={key} data-story-song={key}>
              {previous && words && (
                <div className={`story-seam ${seamSelected ? 'selected' : ''}`} data-story-seam={`${keys[index - 1]}>${key}`} aria-current={seamSelected ? 'true' : undefined}>
                  <p className="story-seam-words">
                    <span className="visually-hidden">From {previous.title} into {item.title}: </span>
                    <Status kind={words.kind}>{words.headline}</Status>
                    {seamSelected && <span className="story-tag">Selected</span>}
                  </p>
                  {words.detail && <p className="hint story-seam-detail">{words.detail}</p>}
                  <button type="button" className="story-edit" aria-label={`Edit this transition: ${previous.title} into ${item.title}`} onClick={() => onEditSeam(keys[index - 1], key)}>
                    <Icon name="edit" size="toolbar" /> Edit this transition
                  </button>
                </div>
              )}
              <div className={`story-song ${songSelected ? 'selected' : ''} ${playing ? 'playing' : ''}`} aria-current={songSelected ? 'true' : undefined}>
                <span className="story-number" aria-hidden="true">{index + 1}</span>
                <div className="story-song-words">
                  <h3 dir="auto"><span className="visually-hidden">{index + 1}. </span>{item.title}</h3>
                  <p><span dir="auto">{item.artist}</span> · <span className="visually-hidden">length </span>{clock(item.duration)}</p>
                  {(playing || songSelected) && (
                    <p className="story-tags">
                      {playing && <span className="story-tag playing"><Icon name="play" size="compact" /> Playing now</span>}
                      {songSelected && <span className="story-tag">Selected</span>}
                    </p>
                  )}
                </div>
                <button type="button" className="story-edit" aria-label={`Edit this song: ${item.title}`} onClick={() => onEditSong(key)}>
                  <Icon name="edit" size="toolbar" /> Edit this song
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
