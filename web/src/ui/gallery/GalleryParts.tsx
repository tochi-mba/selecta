import { useState } from 'react';
import { BrandMark } from '../BrandMark';
import { Menu, Section } from '../controls';
import { DataTable } from '../DataTable';
import { countOf, ellipsize, relativeTime, Truncate } from '../format';
import { Combobox, Select, TextField } from '../formControls';
import { GlossaryDialog, TermHint } from '../Glossary';
import { IconButton, LinkTabs, MenuItem, Popover, SearchField, Slider, VisuallyHidden } from '../primitives';
import { ThemeChoices, ThemeMenu } from '../ThemeChoice';

type Row = { name: string; songs: number; when: number };
const ROWS: Row[] = [
  { name: 'Friday warm-up', songs: 14, when: 90 },
  { name: 'A much longer mix name that has to wrap or shorten on a phone', songs: 1, when: 60 * 60 * 26 },
];
const LONG = 'A very long song title that never fits on one line in a narrow column, kept whole in its title';

/** The smaller primitives, the form controls, the words helpers and compact density. */
export function GalleryParts() {
  const [text, setText] = useState('');
  const [find, setFind] = useState('');
  const [level, setLevel] = useState(40);
  const [pick, setPick] = useState<'one' | 'two'>('one');
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState('');
  const [glossary, setGlossary] = useState(false);
  return (
    <>
      <section className="stack"><h3>Primitives</h3>
        <div className="row wrap">
          <IconButton icon="trash" label="Specimen icon button" />
          <Popover label="Open a popover"><p>Popover words. Escape or a click outside closes it.</p></Popover>
          <Menu label="Specimen menu"><MenuItem>Plain item</MenuItem><MenuItem danger>Danger item</MenuItem></Menu>
          <span className="row"><BrandMark /><span>SelectaDJ, with the brand mark beside it</span></span>
          <span>Hidden words follow<VisuallyHidden>, read only by a screen reader</VisuallyHidden>.</span>
          <TermHint term="harmonic-match" />
          <button onClick={() => setGlossary(true)}>Open the glossary</button>
        </div>
        <LinkTabs label="Specimen page links" current="/workshop/diagnostics" items={[{ path: '/workshop', label: 'Overview' }, { path: '/workshop/diagnostics', label: 'Diagnostics' }]} />
        <SearchField label="Find a specimen" value={find} onChange={setFind} placeholder="Type to filter" onEscape={() => setFind('')} />
        <Slider label="Specimen level" min={0} max={100} value={level} valueText={`${level} percent`} onChange={(event) => setLevel(Number(event.target.value))} />
        <div className="gallery-truncate"><Truncate text={LONG} /></div>
      </section>
      <section className="stack"><h3>Form controls</h3>
        <TextField label="Mix name" help="Shown on the mix and its exports." value={text} onChange={setText} placeholder="Friday warm-up" />
        <TextField label="Contact email" error="Enter an address with an @ in it." type="email" value="not an address" onChange={() => {}} />
        <Select label="Specimen option" value={pick} onChange={setPick} options={[{ value: 'one', label: 'First option' }, { value: 'two', label: 'Second option' }]} />
        <Combobox label="Specimen song" value={typed} onChange={setTyped} onPick={setPicked} options={[{ value: 'opening', label: 'Opening song' }, { value: 'peak', label: 'Peak' }, { value: 'closing', label: 'Closing song' }]} />
        {picked && <p>Picked {picked}.</p>}
      </section>
      <section className="stack"><h3>Words, tables and themes</h3>
        <p>{relativeTime(90)}; {relativeTime(60 * 60 * 26)}; {countOf(1, 'song')}; {countOf(2898, 'song')}; {ellipsize(LONG, 24)}</p>
        <DataTable caption="Specimen mixes" stacked="auto" rowKey={(row) => row.name} rows={ROWS} columns={[
          { key: 'name', label: 'Mix' },
          { key: 'songs', label: 'Songs', numeric: true, render: (row) => countOf(row.songs, 'song') },
          { key: 'when', label: 'Changed', render: (row) => relativeTime(row.when) },
        ]} />
        <DataTable caption="Specimen empty table" rowKey={(row: Row) => row.name} rows={[]} columns={[{ key: 'name', label: 'Mix' }]} empty="No mixes yet." />
        <div className="row wrap"><ThemeMenu /><ThemeChoices /></div>
      </section>
      <section className="stack"><h3>Compact density</h3>
        <p className="hint">The same rows at the compact preference: shorter controls and tighter rows, still 44px targets on touch.</p>
        <ul className="draft-list density" data-density="compact">
          {ROWS.map((row) => <li key={row.name} className="song-row"><span className="song-name">{row.name}</span><button>Open</button></li>)}
        </ul>
        <Section name="Gallery specimen"><p className="soft">A Section frame: if this part failed to draw, only this frame would say so and offer a restart.</p></Section>
      </section>
      {glossary && <GlossaryDialog onClose={() => setGlossary(false)} />}
    </>
  );
}
