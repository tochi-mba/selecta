import { useState } from 'react';
import { navigate } from '../../router';
import type { Command } from '../../shell/commands';
import { ActivityPanel } from '../ActivityPanel';
import { CommandPalette } from '../CommandPalette';
import { ConfirmDialog } from '../ConfirmDialog';
import { announce } from '../controls';
import { Meter } from '../Meter';
import { dismissToast, showProblem, showToast } from '../toasts';

/** Commands for the palette specimen: the real palette, offering pages and one harmless action. */
const COMMANDS: Command[] = [
  { id: 'gallery-overview', label: 'Workspace overview', group: 'Go to', run: () => navigate('/workshop') },
  { id: 'gallery-announce', label: 'Say something to a screen reader', group: 'Do', keywords: 'announce live region', run: () => announce('The palette ran a specimen command.') },
  { id: 'gallery-unavailable', label: 'A command that cannot run now', group: 'Do', unavailable: 'Shown to inspect the unavailable state.', run: () => {} },
];

/**
 * Meters, the confirmation dialog with and without undo, toasts, announcements and the command
 * palette. Each overlay and toast leaves through the exit protocol (data-closing, then unmount on
 * animationend), so closing them here is how that motion is inspected; reduced motion swaps it for
 * a short fade, Still for none.
 */
export function GalleryFeedback() {
  const [confirm, setConfirm] = useState<'undo' | 'permanent' | 'plain' | null>(null);
  const [palette, setPalette] = useState(false);
  const [lastToast, setLastToast] = useState<number | null>(null);
  const [removed, setRemoved] = useState(false);
  return (
    <>
      <section className="stack"><h3>Meters and progress</h3>
        <Meter label="Songs checked" value={312} max={2898} valueText="312 of 2,898 songs" />
        <Meter label="Songs checked, length unknown" valueText="Still counting" />
        <Meter label="Storage used" kind="meter" value={62} warnAt={0.8} dangerAt={0.95} valueText="62 percent" detail="Resets on the 1st." />
        <Meter label="Storage nearly full" kind="meter" value={86} warnAt={0.8} dangerAt={0.95} valueText="86 percent" />
        <Meter label="Storage full" kind="meter" value={99} warnAt={0.8} dangerAt={0.95} valueText="99 percent" />
        <Meter label="Hidden label" value={40} showLabel={false} />
      </section>
      <section className="stack"><h3>Confirmations, toasts and announcements</h3>
        <div className="row wrap">
          <button className="destructive" onClick={() => setConfirm('undo')}>Remove with undo</button>
          <button className="destructive" onClick={() => setConfirm('permanent')}>Remove for good</button>
          <button onClick={() => setConfirm('plain')}>Ask a plain question</button>
          <button onClick={() => setLastToast(showToast('A specimen toast. It leaves on its own.'))}>Show a toast</button>
          <button onClick={() => setLastToast(showToast('A specimen change.', { undo: () => announce('The specimen change was undone.') }))}>Show an undo toast</button>
          <button onClick={() => setLastToast(showProblem('A specimen problem, said plainly.'))}>Show a problem toast</button>
          <button disabled={lastToast === null} onClick={() => { if (lastToast !== null) dismissToast(lastToast); setLastToast(null); }}>Dismiss the last toast</button>
          <button onClick={() => announce('A specimen announcement for screen readers.')}>Announce</button>
          <button onClick={() => setPalette(true)}>Open the command palette</button>
        </div>
        {removed && <p role="status">The specimen was removed. Undo puts it back.</p>}
      </section>
      <section className="stack"><h3>Activity</h3><ActivityPanel /></section>
      {confirm === 'undo' && (
        <ConfirmDialog title="Remove this specimen?" body="It leaves the list at once." destructive onConfirm={() => setRemoved(true)} undo={() => setRemoved(false)} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'permanent' && (
        <ConfirmDialog title="Remove this specimen for good?" body="Nothing real is removed here." destructive confirmLabel="Remove for good" onConfirm={() => setRemoved(true)} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'plain' && (
        <ConfirmDialog title="Use the second option?" body="A question that changes nothing hard to take back." confirmLabel="Use it" cancelLabel="Not now" onConfirm={() => {}} onClose={() => setConfirm(null)} />
      )}
      {palette && <CommandPalette commands={COMMANDS} searchSongs={false} onClose={() => setPalette(false)} />}
    </>
  );
}
