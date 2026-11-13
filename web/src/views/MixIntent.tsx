import { FlagId, useFlags } from '../flags';
import { PageLink } from '../shell/PageLink';
import './mixIntent.css';

// ADR-0423 (mixes.intent_language): Make a Mix says plainly which of two things the listener is
// doing (a quick listen, or building a mix to keep), how long each setting on the page lasts and
// what it applies to, and what plays next. It only adds words and links: every control the page
// already had stays where it was, and with the flag off nothing here renders.

export type SettingScope = 'this-mix' | 'saved-default' | 'this-visit' | 'conversation';

export const SCOPE_WORDS: Record<SettingScope, string> = {
  'this-mix': 'This mix only',
  'saved-default': 'Saved default',
  'this-visit': 'This visit only',
  conversation: 'This conversation',
};

export type ScopedSetting = { id: string; name: string; scope: SettingScope; detail: string };

/** Every setting on Make a Mix, with how long it lasts. Flags decide which ones exist. */
export function scopedSettings(on: (id: FlagId) => boolean): ScopedSetting[] {
  const shaping = on('mixes.shaping');
  const rows: (ScopedSetting | false)[] = [
    {
      id: 'length', name: 'How long, roughly',
      scope: on('mixes.shaping.remember_length') ? 'saved-default' : 'this-visit',
      detail: on('mixes.shaping.remember_length')
        ? 'Kept in this browser for the next mix you make. It never shortens a mix you already have.'
        : 'Used for the mix you make now. A new visit starts at 30 minutes again.',
    },
    shaping && on('mixes.shaping.feel') && { id: 'feel', name: 'Transition feel', scope: 'saved-default', detail: 'Kept by SelectaDJ for every new mix until you change it. A mix you already have keeps its transitions.' },
    shaping && on('mixes.shaping.stem_moves') && { id: 'stems', name: 'Stem-assisted moves', scope: 'saved-default', detail: 'Kept for every new mix until you change it.' },
    shaping && on('mixes.shaping.energy_arc') && { id: 'energy', name: 'Energy shape', scope: 'saved-default', detail: 'Kept for every new mix until you change it.' },
    shaping && on('mixes.shaping.destination') && { id: 'destination', name: 'Ending song', scope: 'saved-default', detail: 'Kept for every new mix until you clear it.' },
    on('mixes.ideas') && { id: 'filter', name: 'Feeling filter', scope: 'this-visit', detail: 'Only changes which ideas you see. Nothing is saved.' },
    on('editor') && { id: 'edits', name: 'Song order and transitions in Edit', scope: 'this-mix', detail: 'Changes the mix you are editing, or the draft you opened. Your defaults and other drafts are untouched.' },
    on('lucy') && { id: 'lucy', name: 'What you tell Lucy', scope: 'conversation', detail: 'Stays in that Lucy conversation. Nothing is saved or played until you choose to.' },
  ];
  return rows.filter((row): row is ScopedSetting => !!row);
}

export function ScopeTag({ scope }: { scope: SettingScope }) {
  return <span className="scope-tag" data-scope={scope}>{SCOPE_WORDS[scope]}</span>;
}

export function MixIntentGuide({ replacing, mixName }: { replacing: boolean; mixName: string }) {
  const on = useFlags();
  const editor = on('editor');
  const drafts = on('drafts');
  const lucy = on('lucy');
  const keep = editor || drafts || lucy;
  return (
    <section className="mix-intents" aria-labelledby="mix-intents-title" data-flag="mixes.intent_language">
      <h2 id="mix-intents-title" className="eyebrow">What would you like to do?</h2>
      <div className="mix-intent-pair">
        <article className="mix-intent" data-intent="quick-listen">
          <h3>Quick listen</h3>
          <p>Press Play on SelectaDJ’s pick or any feeling. It starts at once{replacing ? ` and replaces ${mixName}, which you can undo` : ''}. Nothing new is saved to My Mixes.</p>
          <p className="hint"><ScopeTag scope="this-mix" /> Play makes one mix to listen to now. Your saved defaults stay as they are.</p>
        </article>
        {keep && (
          <article className="mix-intent" data-intent="build-saved">
            <h3>Build a mix to keep</h3>
            <p>
              {[
                editor && 'Shape first opens the new mix in Edit before it plays',
                drafts && 'Save draft keeps it in My Mixes without touching what’s playing',
                lucy && 'Lucy plans an exact order with you',
              ].filter(Boolean).join('. ')}.
            </p>
            <p className="row wrap">
              {drafts && <PageLink to="/mixes/mine" className="button quiet">My Mixes and drafts</PageLink>}
              {lucy && <PageLink to="/mixes/lucy" className="button quiet">Plan with Lucy</PageLink>}
            </p>
          </article>
        )}
      </div>

      <details className="mix-intent-detail" data-detail="scope">
        <summary>How long each setting lasts</summary>
        <ul className="scope-list">
          {scopedSettings(on).map((row) => (
            <li key={row.id} data-setting={row.id}>
              <b>{row.name}</b> <ScopeTag scope={row.scope} />
              <span className="hint">{row.detail}</span>
            </li>
          ))}
        </ul>
      </details>

      <details className="mix-intent-detail" data-detail="queue">
        <summary>What plays next</summary>
        <ul className="scope-list">
          <li data-queue="next"><b>Next song</b><span className="hint">The next song in your current mix, in the order shown on Listen{editor ? ' and in Edit' : ''}. Making a new mix starts it from its first song.</span></li>
          {on('requests') && <li data-queue="request"><b>A song request</b><span className="hint">Doesn’t jump the queue. SelectaDJ looks for a place after an upcoming song where it fits, sometimes through bridge songs, and asks you first when a route needs your choice. Until then it has no play time.</span></li>}
          <li data-queue="render"><b>Preparing transitions</b><span className="hint">The mix that’s playing is always prepared first{drafts ? '; drafts wait in the render line in their order' : ''}. That order is preparation only, not the order songs play.</span></li>
          <li data-queue="analysis"><b>Song analysis</b><span className="hint">Which songs are analysed first only decides which ones become mix-ready sooner. It never changes what plays next.</span></li>
        </ul>
      </details>
    </section>
  );
}
