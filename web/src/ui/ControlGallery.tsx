import { useState } from 'react';
import { Action, Dialog, Drawer, Menu, Problem, Sheet, Skeleton, Status, Tooltip, Workspace } from './controls';
import { Icon } from './Icon';
import { Field, Tabs } from './primitives';
import { GalleryFeedback } from './gallery/GalleryFeedback';
import { GalleryMusic } from './gallery/GalleryMusic';
import { GalleryParts } from './gallery/GalleryParts';
import { GALLERY_KINDS, GALLERY_SKELETONS } from './gallery/specimens';

/** Development-only inspection surface; no remote data, audio or production operations. Every ui/
 * export appears here or in the cloud harness gallery (harness/CloudGallery.tsx), or is named with a
 * reason in gallery-completeness.test.ts. */
export function ControlGallery() {
  const [overlay, setOverlay] = useState<'dialog' | 'drawer' | 'sheet' | 'workspace' | null>(null);
  const [selected, setSelected] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'first' | 'second' | 'third'>('first');
  const contents = <><p>Check keyboard focus, Escape, scrolling and restoration.</p><label>Example input<input placeholder="Enter a value" /></label><button onClick={() => setOverlay(null)}>Done</button></>;
  return (
    <details className="panel control-gallery">
      <summary>Development component gallery</summary>
      <p className="hint">Inspect in both system themes, at narrow widths and with reduced motion. Focus and hover each control to inspect its interactive states. Close any overlay, menu, tooltip or toast to inspect its exit.</p>
      <section className="stack"><h3>Actions and feedback</h3><div className="row wrap">
        <button>Default</button><button className="primary">Primary</button><button disabled>Disabled</button>
        <button aria-pressed={selected} onClick={() => setSelected(!selected)}>Toggle selection</button>
        <button aria-label="Example icon action" title="Example icon action"><Icon name="edit" /></button>
        <button data-working aria-busy="true">Working</button>
        <button disabled data-working aria-busy="true" aria-disabled="true">Busy and disabled</button>
        <Action working="Saving this longer label…" run={() => new Promise<void>((resolve) => window.setTimeout(() => { setSaved(true); resolve(); }, 1200))}>Save</Action>
        <Tooltip text="Available on hover and keyboard focus"><button>Tooltip</button></Tooltip>
        <button className="destructive">Delete example</button>
        <Menu label="More actions"><button role="menuitem">First action</button><button role="menuitem">Second action</button><button role="menuitem" className="destructive">Delete from menu</button></Menu>
      </div>{saved && <p role="status">Saved locally for this demonstration.</p>}
      <div className="row wrap">{GALLERY_KINDS.map((kind) => <Status key={kind} kind={kind} />)}</div></section>
      <section className="stack"><h3>Fields and validation</h3>
        <label>Search<input type="search" placeholder="Artist or title" /></label>
        <Field className="gallery-field" label="Invalid field" help="A whole number of minutes." error="Choose a value between 1 and 10.">{(field) => <input {...field} defaultValue="Invalid value" />}</Field>
        <label>Choice<select defaultValue="one"><option value="one">First option</option><option value="two">A substantially longer option label</option></select></label>
        <label>Range<input type="range" min={0} max={100} defaultValue={50} /></label>
        <label className="choice"><input type="checkbox" />Checkbox label</label>
      </section>
      <section className="stack gallery-tabs"><h3>Tabs</h3>
        <Tabs label="Example tabs" tabs={[{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }, { id: 'third', label: 'A longer third tab' }]} current={tab} onChange={setTab}><p>Showing the {tab} tab.</p></Tabs>
      </section>
      <section className="stack gallery-content" id="gallery-links"><h3>Links, chips, badges, rows and cards</h3>
        <p><a href="#gallery-links">Example text link</a></p>
        <div className="chips" role="group" aria-label="Example chips"><button aria-pressed="true">Selected chip</button><button aria-pressed="false">Chip</button><button aria-pressed="false" disabled>Unavailable chip</button></div>
        <div className="row wrap" aria-label="Example badges"><span className="pill ready">Ready</span><span className="pill queued">In line</span><span className="pill failed">Couldn’t be made</span><span className="pill">A longer badge label that wraps</span></div>
        <div className="song-row"><span className="song-name">A long example song title that wraps onto a second line</span><small className="soft">Example artist</small></div>
        <article className="card"><h3>Example card</h3><p className="soft">Card description and metadata.</p><div className="card-actions"><button>Card action</button></div></article>
      </section>
      <section className="stack"><h3>Overlays and recovery</h3><div className="row wrap"><button onClick={() => setOverlay('dialog')}>Open dialog</button><button onClick={() => setOverlay('drawer')}>Open drawer</button><button onClick={() => setOverlay('sheet')}>Open sheet</button><button onClick={() => setOverlay('workspace')}>Open workspace</button></div>
        <Problem retry={() => {}}>Example: content could not be loaded.</Problem>
        <div className="empty-state"><h3>No matching results</h3><p>Clear your filters or try another query.</p><button>Clear filters</button></div>
      </section>
      <GalleryFeedback />
      <GalleryParts />
      <GalleryMusic />
      <section className="stack"><h3>Loading geometry</h3>{GALLERY_SKELETONS.map((variant) => <div key={variant}><h4>{variant}</h4><Skeleton variant={variant} lines={2} label={`${variant} loading example`} /></div>)}</section>
      {overlay === 'dialog' && <Dialog title="Example dialog" onClose={() => setOverlay(null)}>{contents}</Dialog>}
      {overlay === 'drawer' && <Drawer title="Example drawer" onClose={() => setOverlay(null)}>{contents}</Drawer>}
      {overlay === 'sheet' && <Sheet title="Example sheet" onClose={() => setOverlay(null)}>{contents}</Sheet>}
      {overlay === 'workspace' && <Workspace title="Example workspace" onClose={() => setOverlay(null)}>{contents}</Workspace>}
    </details>
  );
}
