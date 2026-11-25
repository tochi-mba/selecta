import { FormEvent, useEffect, useRef, useState } from 'react';
import { feelOn } from '../feel/root';
import { accountFlagOn } from '../flags';
import { Action } from '../ui/controls';
import type { Account } from './api';
import { SettingsCard } from './AccountLayout';

// A new account's workspace is called "Personal" until the person names it (product audit item
// 5). This offers the rename once, quietly: answered or dismissed, it does not come back in this
// browser. Only the owner sees it, and only while the name is still the starting one.

export const STARTING_NAME = 'Personal';
const SEEN = 'selecta.workspaceNameOffered';
/** With the feel system's motion on, how long the offer stays after a rename, so the Rename
 * button's drawn tick (ui/controls.tsx, about 900ms) is seen before the card goes. */
const SAVED_MS = 900;

function offered(): boolean {
  try { return localStorage.getItem(SEEN) === '1'; } catch { return false; }
}

function remember() {
  try { localStorage.setItem(SEEN, '1'); } catch { /* shown again next visit, nothing lost */ }
}

export function WorkspaceNameOffer({ account, rename }: {
  account: Account;
  rename: (name: string) => Promise<unknown>;
}) {
  const [gone, setGone] = useState(offered);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const leaving = useRef(0);
  useEffect(() => () => window.clearTimeout(leaving.current), []);
  if (gone || account.workspace.name !== STARTING_NAME || account.workspace.role !== 'owner'
    || !accountFlagOn('account.workspace_name', account.features)) return null;
  const close = () => { remember(); setGone(true); };
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const wanted = name.trim();
    if (!wanted) { setProblem('Type a name first.'); return false; }
    try {
      await rename(wanted);
      // the rename really saved: with motion on the tick is drawn first, then the card goes
      if (feelOn('motion')) {
        remember();
        window.clearTimeout(leaving.current);
        leaving.current = window.setTimeout(() => setGone(true), SAVED_MS);
      } else close();
    } catch (error) {
      setProblem((error as Error).message || 'That did not save. Try again.');
      return false; // reported here: the Rename button draws no tick
    }
  };
  return (
    <SettingsCard id="cloud-workspace-name" title="Your workspace" about={`It is called “${STARTING_NAME}”. Rename it if you like; only you see it.`}>
      <form className="acct-row-actions" onSubmit={(event) => void save(event)}>
        <label className="visually-hidden" htmlFor="workspace-name">Workspace name</label>
        <input id="workspace-name" value={name} maxLength={60} placeholder="My music" onChange={(event) => { setName(event.target.value); setProblem(''); }} />
        <Action type="button" run={() => save()} working="Saving…">Rename it</Action>
        <button type="button" className="quiet" onClick={close}>Keep “{STARTING_NAME}”</button>
      </form>
      {problem && <p className="cloud-inline-error" role="alert">{problem}</p>}
    </SettingsCard>
  );
}
