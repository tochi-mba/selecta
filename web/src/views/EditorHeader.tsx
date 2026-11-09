import { ReactNode, useEffect, useState } from 'react';
import { DraftList, get, MixEta, MixItem } from '../api';
import { flagOn, useFlag } from '../flags';
import { etaRangeWords, length, nth } from '../lib';
import { MixReadiness, orderOf } from '../state/readiness';
import { Status, StatusKind } from '../ui/controls';

/** A short name for this exact order of songs, so "the mix I was looking at" and "the mix now" can be
 * told apart at a glance. It's a label, not a security check: the x-mix-order header is what guards a
 * change. */
export function revisionOf(mix: Pick<MixItem, 'song_id'>[]): string {
  let hash = 0x811c9dc5;
  for (const character of orderOf(mix)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 4);
}

function readinessWords(state: MixReadiness): { kind: StatusKind; words: string } {
  if (!state.seams) return { kind: 'planned', words: 'Add another song to make a transition' };
  if (state.allReady) return { kind: 'ready', words: 'All transitions ready' };
  const done = `${state.ready} of ${state.seams} transitions made`;
  if (state.failed) return { kind: 'warning', words: `${done}, ${state.failed} couldn’t be made` };
  if (state.rendering) return { kind: 'working', words: `${done}, ${state.rendering} on the way` };
  return { kind: 'planned', words: done };
}

/** Which mix is being edited, for as soon as there's more than one. */
export function MixSwitcher({ draftId, openDraft, closeDraft }: { draftId: number | null; openDraft?: (id: number) => void; closeDraft: () => void }) {
  const [list, setList] = useState<DraftList | null>(null);
  const drafts = useFlag('drafts');
  useEffect(() => {
    if (drafts) get<DraftList>('/drafts').then(setList).catch(() => {});
  }, [draftId, drafts]);
  if (!drafts || !list || !list.drafts.length) return null;
  return (
    <label className="switcher">
      Editing
      <select
        value={draftId ?? 'current'}
        onChange={(event) => {
          if (event.target.value === 'current') closeDraft();
          else openDraft?.(Number(event.target.value));
        }}
      >
        <option value="current">Current mix: {list.current.name}</option>
        {list.drafts.map((draft) => (
          <option key={draft.id} value={draft.id}>Draft: {draft.name}</option>
        ))}
      </select>
    </label>
  );
}

/** The top of the editor. The bar stays on screen while the timeline scrolls, because whether a change
 * reaches what's playing is the one thing that must never be in doubt here. */
export function EditorHeader(props: {
  draftId: number | null;
  mix: MixItem[];
  mixName: string;
  mixEta?: MixEta;
  draftPlace?: number | null;
  currentMixName?: string;
  readiness: MixReadiness;
  totalSeconds: number;
  switcher: ReactNode;
  actions: ReactNode;
  /** Story, Arrange or Detail: how the same mix is shown below. */
  view?: ReactNode;
}) {
  const { draftId, mix, mixName, mixEta, draftPlace, currentMixName, readiness, totalSeconds, switcher, actions, view } = props;
  const inDraft = draftId !== null;
  const facts = readinessWords(readiness);
  const { seams, ready } = readiness;
  return (
    <header className="editor-head">
      <div className={`editor-scope ${inDraft ? 'is-draft' : 'is-current'}`} role="group" aria-label="What you’re editing">
        <span className="scope-badge">{inDraft ? 'Editing a draft' : 'Editing the current mix'}</span>
        <span className="scope-words">
          {inDraft
            ? `Nothing here touches ${currentMixName ?? 'what’s playing'}.`
            : 'Changes here change what’s playing.'}
        </span>
        <span className="scope-revision" title="Changes whenever the order of songs changes">Revision {revisionOf(mix)}</span>
        <Status kind={facts.kind}>{facts.words}</Status>
      </div>
      <div className="mix-head">
        <div>
          {switcher}
          <p className="eyebrow">{inDraft ? 'Draft · saved as you edit' : 'Current mix'}</p>
          <h1 className="display small">{mixName}</h1>
          <p className="lede">
            {mix.length} {mix.length === 1 ? 'song' : 'songs'}, about {length(totalSeconds)}.
            {seams > 0 && ` ${ready} of ${seams} transitions are ready.`}
            {!inDraft && mixEta && mixEta.seams > 0 && (mixEta.late ? ' The rest are taking longer than usual.' : ` The rest take ${etaRangeWords(mixEta)}.`)}
            {inDraft && flagOn('render_line') && mixEta && mixEta.seams > 0 && (draftPlace
              ? ` ${nth(draftPlace)} in line. All ready in ${etaRangeWords(mixEta)}.`
              : ` Prioritize it and all of it would be ready in ${etaRangeWords(mixEta)}.`)}
            {seams > 0 && flagOn('seam_inspector') && ' Select a transition to hear or change it.'}
          </p>
          {inDraft && <p className="hint">Saved as you go. What’s playing isn’t affected.</p>}
        </div>
        <div className="row wrap editor-actions">{actions}</div>
      </div>
      {view && <div className="editor-view">{view}</div>}
    </header>
  );
}
