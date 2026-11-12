import { FormEvent, useEffect, useState } from 'react';
import { problemKind } from '../api';
import { lucy } from '../lucy/client';
import type { Conversation } from '../lucy/types';
import { whenWords } from '../lucy/words';
import { navigate } from '../router';
import { PageLink } from '../shell/PageLink';
import { Action, Menu, Problem, Skeleton } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SearchField } from '../ui/primitives';
import { NativeDialog } from './LucyDialog';

/** Earlier conversations with Lucy: open one, start a new one, rename, archive or delete. Deleting a
 * conversation never touches a draft that was already saved from it. */

const titleOf = (conversation: Conversation) => conversation.title || conversation.last_user_text || 'Untitled conversation';

export function LucyHistory({ currentId, refreshKey, onPicked }: { currentId: string | null; refreshKey: string; onPicked?: () => void }) {
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [archived, setArchived] = useState(false);
  const [list, setList] = useState<Conversation[] | null>(null);
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setAsked(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let live = true;
    lucy.conversations(asked, archived)
      .then((answer) => {
        if (!live) return;
        setList(answer.conversations ?? []);
        setProblem('');
      })
      .catch((error: Error) => {
        if (live) setProblem(problemKind(error) === 'offline' ? 'Can’t reach SelectaDJ right now.' : error.message);
      });
    return () => { live = false; };
  }, [asked, archived, refreshKey, attempt]);

  const again = () => setAttempt((value) => value + 1);

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) return;
    await lucy.updateConversation(renaming.id, { title });
    setRenaming(null);
    again();
  };

  const archive = async (conversation: Conversation) => {
    await lucy.updateConversation(conversation.id, { archived: !conversation.archived });
    again();
  };

  const remove = async () => {
    const gone = deleting;
    if (!gone) return;
    await lucy.deleteConversation(gone.id);
    setDeleting(null);
    if (gone.id === currentId) navigate('/mixes/lucy');
    again();
  };

  return (
    <nav className="lucy-history" aria-label="Conversations with Lucy">
      <div className="lucy-history-head">
        <h2>Conversations</h2>
        <PageLink to="/mixes/lucy" className="button" onClick={onPicked}><Icon name="plus" size="toolbar" /> New</PageLink>
      </div>
      <SearchField label="Search conversations" value={query} onChange={setQuery} placeholder="Search" />
      <label className="choice lucy-archived-toggle">
        <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />
        Show archived
      </label>
      {problem && !list && <Problem retry={again}>{problem}</Problem>}
      {problem && list && <p className="hint" role="status">{problem} Showing what was here before.</p>}
      {!list && !problem && <Skeleton lines={4} label="Finding your conversations" />}
      {list && !list.length && <p className="hint">{asked ? 'No conversations match that.' : archived ? 'Nothing archived.' : 'No conversations yet.'}</p>}
      {list && list.length > 0 && (
        <ul className="lucy-history-list">
          {list.map((conversation) => {
            const title = titleOf(conversation);
            return (
              <li key={conversation.id} className={conversation.id === currentId ? 'is-current' : ''}>
                {renaming?.id === conversation.id ? (
                  <form className="lucy-rename" onSubmit={(event) => void rename(event).catch(() => {})}>
                    <input autoFocus aria-label={`New name for ${title}`} value={renaming.title} maxLength={120}
                      onChange={(event) => setRenaming({ id: conversation.id, title: event.target.value })}
                      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null); } }} />
                    <div className="row">
                      <button type="submit" className="primary" disabled={!renaming.title.trim()}>Save</button>
                      <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <PageLink to={`/mixes/lucy/${conversation.id}`} aria-current={conversation.id === currentId ? 'page' : undefined} onClick={onPicked}>
                      <b dir="auto">{title}</b>
                      <span className="hint">{whenWords(conversation.updated_at)}{conversation.branched_from ? ' · branched' : ''}{conversation.archived ? ' · archived' : ''}</span>
                    </PageLink>
                    <Menu title={`More for ${title}`} label={<><Icon name="more" /><span className="visually-hidden">More for {title}</span></>}>
                      <button type="button" role="menuitem" onClick={() => setRenaming({ id: conversation.id, title: conversation.title })}>Rename</button>
                      <Action role="menuitem" run={() => archive(conversation)}>{conversation.archived ? 'Unarchive' : 'Archive'}</Action>
                      <button type="button" role="menuitem" className="destructive" onClick={() => setDeleting(conversation)}>Delete</button>
                    </Menu>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {deleting && (
        <NativeDialog
          title="Delete this conversation?"
          onClose={() => setDeleting(null)}
          footer={(
            <>
              <button type="button" data-autofocus onClick={() => setDeleting(null)}>Keep it</button>
              <Action className="destructive" working="Deleting…" run={remove}>Delete conversation</Action>
            </>
          )}
        >
          <p><b dir="auto">{titleOf(deleting)}</b> and the mixes Lucy proposed in it will be deleted.</p>
          <p>Drafts you already saved from it are kept in My Mixes, and your music is never touched.</p>
        </NativeDialog>
      )}
    </nav>
  );
}
